import { Request, Response, Router } from 'express';
import BaseController from './BaseController';
import { IController } from '../../common/interfaces';
import { IVerificationService } from '@ethereum-sourcify/verification';
import { InputData, getChainId, Logger, PathBuffer, CheckedContract, isEmpty, PathContent, Match } from '@ethereum-sourcify/core';
import { BadRequestError, NotFoundError, PayloadTooLargeError, ValidationError } from '../../common/errors'
import { IValidationService } from '@ethereum-sourcify/validation';
import * as bunyan from 'bunyan';
import fileUpload from 'express-fileupload';
import { isValidAddress } from '../../common/validators/validators';
import { MySession, getSessionJSON, generateId, isVerifiable, SendableContract, ContractWrapperMap, updateUnused, MyRequest, addRemoteFile } from './VerificationController-util';
import { StatusCodes } from 'http-status-codes';
import { body, query, validationResult } from 'express-validator';
import web3utils from "web3-utils";

const FILE_ENCODING = "base64";

export default class VerificationController extends BaseController implements IController {
    router: Router;
    verificationService: IVerificationService;
    validationService: IValidationService;
    logger: bunyan;

    static readonly MAX_INPUT_SIZE = 10 * 1024 * 1024; // 10 MiB

    constructor(verificationService: IVerificationService, validationService: IValidationService) {
        super();
        this.router = Router();
        this.verificationService = verificationService;
        this.validationService = validationService;
        this.logger = Logger("VerificationService");
    }

    private validateAddresses(addresses: string): string[] {
        const addressesArray = addresses.split(",");
        const invalidAddresses: string[] = [];
        for (const i in addressesArray) {
            const address = addressesArray[i];
            if (!isValidAddress(address)) {
                invalidAddresses.push(address);
            } else {
                addressesArray[i] = web3utils.toChecksumAddress(address);
            }
        }

        if (invalidAddresses.length) {
            throw new Error(`Invalid addresses: ${invalidAddresses.join(", ")}`);
        }
        return addressesArray;
    }

    private validateChainIds(chainIds: string): string[] {
        const chainIdsArray = chainIds.split(",");
        const validChainIds: string[] = [];
        const invalidChainIds: string[] = [];
        for (const chainId of chainIdsArray) {
            try {
                validChainIds.push(getChainId(chainId));
            } catch (e) {
                invalidChainIds.push(chainId);
            }
        }

        if (invalidChainIds.length) {
            throw new Error(`Invalid chainIds: ${invalidChainIds.join(", ")}`);
        }
        return validChainIds;
    }

    private stringifyInvalidAndMissing(contract: CheckedContract) {
        const errors = Object.keys(contract.invalid).concat(Object.keys(contract.missing));
        return `${contract.name} (${errors.join(", ")})`;
    }
    
    private legacyVerifyEndpoint = async (origReq: Request, res: Response): Promise<any> => {
        const req = (origReq as MyRequest);
        this.validateRequest(req);

        for (const address of req.addresses) {
            const result = this.verificationService.findByAddress(address, req.chain);
            if (result.length != 0) {
                return res.send({ result });
            }
        }

        const inputFiles = this.extractFiles(req);
        if (!inputFiles) {
            const msg = "The contract at the provided address and chain has not yet been sourcified.";
            throw new NotFoundError(msg);
        }

        let validatedContracts: CheckedContract[];
        try {
            validatedContracts = this.validationService.checkFiles(inputFiles);
        } catch(error: any) {
            throw new BadRequestError(error.message);
        }

        const errors = validatedContracts
                        .filter(contract => !CheckedContract.isValid(contract, true))
                        .map(this.stringifyInvalidAndMissing);
        if (errors.length) {
            throw new BadRequestError("Invalid or missing sources in:\n" + errors.join("\n"), false);
        }

        if (validatedContracts.length !== 1 && !req.body.chosenContract) {
            const contractNames = validatedContracts.map(c => c.name).join(", ");
            const msg = `Detected ${validatedContracts.length} contracts (${contractNames}), but can only verify 1 at a time. Please choose a main contract and click Verify again.`;
            const contractsToChoose = validatedContracts.map(contract => ({name: contract.name, path: contract.compiledPath}))
            return res.status(StatusCodes.BAD_REQUEST).send({error: msg, contractsToChoose})
        }

        const contract = req.body.chosenContract ? validatedContracts[req.body.chosenContract] : validatedContracts[0];
        if (!contract.compilerVersion) {
            throw new BadRequestError("Metadata file not specifying a compiler version.");
        }

        const inputData: InputData = { contract, addresses: req.addresses, chain: req.chain };

        const resultPromise = this.verificationService.inject(inputData);
        resultPromise.then(result => {
            res.send({ result: [result] }); // array is an old expected behavior (e.g. by frontend)
        }).catch(error => {
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).send({ error: error.message });
        });
    }

    private checkAllByAddresses = async (req: any, res: Response) => {
        this.validateRequest(req);
        const map: Map<string, any> = new Map();
        for (const address of req.addresses) {
            for (const chainId of req.chainIds) {
                try {
                    const found: Match[] = this.verificationService.findAllByAddress(address, chainId);
                    if (found.length != 0) {
                        if (!map.has(address)) {
                            map.set(address, { address, chainIds: [] });
                        }


                        map.get(address).chainIds.push({chainId, status: found[0].status});
                    }
                } catch (error) {
                    // ignore
                }
            }
            if (!map.has(address)) {
                map.set(address, {
                    "address": address,
                    "status": "false"
                })
            }
        }
        const resultArray = Array.from(map.values());
        res.send(resultArray)
    }

    private checkByAddresses = async (req: any, res: Response) => {
        this.validateRequest(req);
        const map: Map<string, any> = new Map();
        for (const address of req.addresses) {
            for (const chainId of req.chainIds) {
                try {
                    const found: Match[] = this.verificationService.findByAddress(address, chainId);
                    if (found.length != 0) {
                        if (!map.has(address)) {
                            map.set(address, { address, status: "perfect", chainIds: [] });
                        }

                        map.get(address).chainIds.push(chainId);
                    }
                } catch (error) {
                    // ignore
                }
            }
            if (!map.has(address)) {
                map.set(address, {
                    "address": address,
                    "status": "false"
                })
            }
        }
        const resultArray = Array.from(map.values());
        res.send(resultArray)
    }

    private validateContracts = (session: MySession) => {
        const pathBuffers: PathBuffer[] = [];
        for (const id in session.inputFiles) {
            const pathContent = session.inputFiles[id];
            pathBuffers.push({ path: pathContent.path, buffer: Buffer.from(pathContent.content, FILE_ENCODING) });
        }
        
        try {
            const unused: string[] = [];
            const contracts = this.validationService.checkFiles(pathBuffers, unused);

            const newPendingContracts: ContractWrapperMap = {};
            for (const contract of contracts) {
                newPendingContracts[generateId(contract.metadataRaw)] = { contract };
            }
            
            session.contractWrappers ||= {};
            for (const newId in newPendingContracts) {
                const newContractWrapper = newPendingContracts[newId];
                const oldContractWrapper = session.contractWrappers[newId];
                if (oldContractWrapper) {
                    for (const path in newContractWrapper.contract.solidity) {
                        oldContractWrapper.contract.solidity[path] = newContractWrapper.contract.solidity[path];
                        delete oldContractWrapper.contract.missing[path];
                    }
                    oldContractWrapper.contract.solidity = newContractWrapper.contract.solidity;
                    oldContractWrapper.contract.missing = newContractWrapper.contract.missing;
                } else {
                    session.contractWrappers[newId] = newContractWrapper;
                }
            }
            updateUnused(unused, session);

        } catch(error) {
            const paths = pathBuffers.map(pb => pb.path);
            updateUnused(paths, session);
        }
    }

    private verifyValidatedEndpoint = async (req: Request, res: Response) => {
        const session = (req.session as MySession);
        if (!session.contractWrappers || isEmpty(session.contractWrappers)) {
            throw new BadRequestError("There are currently no pending contracts.");
        }

        const receivedContracts: SendableContract[] = req.body.contracts;

        const verifiable: ContractWrapperMap = {};
        for (const receivedContract of receivedContracts) {
            const id = receivedContract.verificationId;
            const contractWrapper = session.contractWrappers[id];
            if (contractWrapper) {
                contractWrapper.address = receivedContract.address;
                contractWrapper.chainId = receivedContract.chainId;

                if (isVerifiable(contractWrapper)) {
                    verifiable[id] = contractWrapper;
                }
            }
        }

        await this.verifyValidated(verifiable);
        res.send(getSessionJSON(session));
    }

    private async verifyValidated(contractWrappers: ContractWrapperMap): Promise<void> {
        for (const id in contractWrappers) {
            const contractWrapper = contractWrappers[id];

            await this.checkAndFetchMissing(contractWrapper.contract);

            if (!isVerifiable(contractWrapper)) {
                continue;
            }
            const inputData: InputData = { addresses: [contractWrapper.address], chain: contractWrapper.chainId, contract: contractWrapper.contract };

            const found = this.verificationService.findByAddress(contractWrapper.address, contractWrapper.chainId);
            let match: Match;
            if (found.length) {
                match = found[0];

            } else {
                const matchPromise = this.verificationService.inject(inputData);
                match = await matchPromise.catch((error: Error): Match => {
                    return {
                        status: null,
                        address: null,
                        message: error.message,
                    };
                });
            }

            contractWrapper.status = match.status || "error";
            contractWrapper.statusMessage = match.message;
            contractWrapper.storageTimestamp = match.storageTimestamp;
        }
    }

    private async checkAndFetchMissing(contract: CheckedContract): Promise<void> {
        if (!CheckedContract.isValid(contract)) {
            const logObject = { loc: "[VERIFY_VALIDATED_ENDPOINT]", contract: contract.name };
            this.logger.info(logObject, "Attempting fetching of missing sources");
            await CheckedContract.fetchMissing(contract, this.logger).catch(err => {
                this.logger.error(logObject, err);
            });
        }
    }

    private extractFiles = (req: Request, shouldThrow = false) => {
        if (req.is("multipart/form-data") && req.files && req.files.files) {
            return this.extractFilesFromForm(req.files.files);
        } else if (req.is("application/json") && req.body.files) {
            return this.extractFilesFromJSON(req.body.files);
        }

        if (shouldThrow) {
            throw new ValidationError([{ param: "files", msg: "There should be files in the <files> field" }]);
        }
    }

    private extractFilesFromForm(files: any): PathBuffer[] {
        const fileArr: fileUpload.UploadedFile[] = [].concat(files); // ensure an array, regardless of how many files received
        return fileArr.map(f => ({ path: f.name, buffer: f.data }));
    }
    
    private extractFilesFromJSON(files: any): PathBuffer[] {
        const inputFiles = [];
        for (const name in files) {
            const file = files[name];
            const buffer = (Buffer.isBuffer(file) ? file : Buffer.from(file));
            inputFiles.push({ path: name, buffer });
        }
        return inputFiles;
    }

    private saveFiles(pathContents: PathContent[], session: MySession): number {
        if (!session.inputFiles) {
            session.inputFiles = {};
        }
        
        let inputSize = 0; // shall contain old buffer size + new files size
        for (const id in session.inputFiles) {
            const pc = session.inputFiles[id];
            inputSize += pc.content.length;
        }

        pathContents.forEach(pc => inputSize += pc.content.length);

        if (inputSize > VerificationController.MAX_INPUT_SIZE) {
            const msg = "Too much session memory used. Delete some files or restart the session.";
            throw new PayloadTooLargeError(msg);
        }

        let newFilesCount = 0;
        pathContents.forEach(pc => {
            const newId = generateId(pc.content);
            if (!(newId in session.inputFiles)) {
                session.inputFiles[newId] = pc;
                ++newFilesCount;
            }
        });

        return newFilesCount;
    }

    private addInputFilesEndpoint = async (req: Request, res: Response) => {
        this.validateRequest(req);
        let inputFiles: PathBuffer[];
        if (req.query.url) {
            inputFiles = await addRemoteFile(req.query)
        } else {
            inputFiles = this.extractFiles(req, true);
        }
        const pathContents: PathContent[] = inputFiles.map(pb => {
            return { path: pb.path, content: pb.buffer.toString(FILE_ENCODING) }
        });

        const session = (req.session as MySession);
        const newFilesCount = this.saveFiles(pathContents, session);
        if (newFilesCount) {
            this.validateContracts(session);
            await this.verifyValidated(session.contractWrappers);
        }
        res.send(getSessionJSON(session));
    }

    private restartSessionEndpoint = async (req: Request, res: Response) => {
        req.session.destroy((error: Error) => {
            let logMethod: keyof bunyan = null;
            let msg = "";
            let statusCode = null;

            const loggerOptions: any = { loc: "[VERIFICATION_CONTROLER:RESTART]", id: req.sessionID };
            if (error) {
                logMethod = "error";
                msg = "Error in session restart";
                loggerOptions.err = error.message;
                statusCode = StatusCodes.INTERNAL_SERVER_ERROR;

            } else {
                logMethod = "info";
                msg = "Session successfully restarted";
                statusCode = StatusCodes.OK;
            }

            this.logger[logMethod](loggerOptions, msg);
            res.status(statusCode).send(msg);
        });
    }

    private getSessionDataEndpoint = async (req: Request, res: Response) => {
        res.send(getSessionJSON(req.session as MySession));
    }

    private validateRequest(req: Request) {
        const result = validationResult(req);
        if (!result.isEmpty()) {
            throw new ValidationError(result.array());
        }
    }

    registerRoutes = (): Router => {
        this.router.route(['/', '/verify'])
            .post(
                body("address").exists().bail().custom((address, { req }) => req.addresses = this.validateAddresses(address)),
                body("chain").exists().bail().custom((chain, { req }) => req.chain = getChainId(chain)),
                this.safeHandler(this.legacyVerifyEndpoint)
            );

        this.router.route(['/check-all-by-addresses', '/checkAllByAddresses'])
            .get(
                query("addresses").exists().bail().custom((addresses, { req }) => req.addresses = this.validateAddresses(addresses)),
                query("chainIds").exists().bail().custom((chainIds, { req }) => req.chainIds = this.validateChainIds(chainIds)),
                this.safeHandler(this.checkAllByAddresses)
            );

        this.router.route(['/check-by-addresses', '/checkByAddresses'])
            .get(
                query("addresses").exists().bail().custom((addresses, { req }) => req.addresses = this.validateAddresses(addresses)),
                query("chainIds").exists().bail().custom((chainIds, { req }) => req.chainIds = this.validateChainIds(chainIds)),
                this.safeHandler(this.checkByAddresses)
            );

        this.router.route('/session-data')
            .get(this.safeHandler(this.getSessionDataEndpoint));
        
        this.router.route('/input-files')
            .post(this.safeHandler(this.addInputFilesEndpoint));
        
        this.router.route('/restart-session')
            .post(this.safeHandler(this.restartSessionEndpoint));

        this.router.route('/verify-validated')
            .post(
                body("contracts").isArray(),
                this.safeHandler(this.verifyValidatedEndpoint)
            );

        return this.router;
    }
}