import { logError, logInfo, logDebug } from '../logger';
import { id as keccak256str } from 'ethers';
import { IpfsGateway } from './ValidationTypes';

export async function performFetch(
  url: string,
  hash?: string,
  fileName?: string,
  headers: HeadersInit = {},
): Promise<string | null> {
  logInfo('Fetching file', {
    url,
    hash,
    fileName,
  });
  const res = await fetchWithBackoff(url, headers).catch((err) => {
    logError(err);
  });

  if (res) {
    if (res.status === 200) {
      const content = await res.text();
      if (hash && keccak256str(content) !== hash) {
        logError("The calculated and the provided hash don't match.");
        return null;
      }

      logInfo('Fetched the file', {
        fileName,
        url,
        hash,
      });
      return content;
    } else {
      logError('Failed to fetch the file', {
        url,
        hash,
        fileName,
        status: res.status,
      });
      return null;
    }
  }
  return null;
}

/**
 * Fetches a resource with an exponential timeout.
 * 1) Send req, wait backoff * 2^0 ms, abort if doesn't resolve
 * 2) Send req, wait backoff * 2^1 ms, abort if doesn't resolve
 * 3) Send req, wait backoff * 2^2 ms, abort if doesn't resolve...
 * ...
 * ...
 */
export async function fetchWithBackoff(
  resource: string,
  headers: HeadersInit = {},
  backoff: number = 10000,
  retries: number = 4,
) {
  let timeout = backoff;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      logDebug('Start fetchWithBackoff', {
        resource,
        headers,
        timeout,
        attempt,
      });
      const controller = new AbortController();
      const id = setTimeout(() => {
        logDebug('Aborting request', { resource, headers, timeout, attempt });
        controller.abort();
      }, timeout);
      const response = await fetch(resource, {
        signal: controller.signal,
        headers,
      });
      logDebug('Success fetchWithBackoff', { resource, timeout, attempt });
      clearTimeout(id);
      return response;
    } catch (error) {
      if (attempt === retries) {
        logError('Failed fetchWithBackoff', {
          resource,
          headers,
          attempt,
          retries,
          timeout,
          error,
        });
        throw new Error(`Failed fetching ${resource}: ${error}`);
      } else {
        timeout *= 2; // exponential backoff
        logDebug('Retrying fetchWithBackoff', {
          resource,
          headers,
          attempt,
          timeout,
          error,
        });
        continue;
      }
    }
  }
  throw new Error(`Failed fetching ${resource}`);
}

/**
 * Because the gateway might change across tests, don't set it to a variable but look for env variable.
 * Otherwise fall back to the default ipfs.io.
 *
 * This will likely moved to server or somewhere else. But keep it here for now.
 */
export function getIpfsGateway(): IpfsGateway {
  let ipfsGatewaysHeaders;
  if (process.env.IPFS_GATEWAY_HEADERS) {
    try {
      ipfsGatewaysHeaders = JSON.parse(process.env.IPFS_GATEWAY_HEADERS);
    } catch (error) {
      logError('Error while parsing IPFS_GATEWAY_HEADERS option', { error });
      throw new Error('Error while parsing IPFS_GATEWAY_HEADERS option');
    }
  }

  const ipfsGatewayUrl = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';
  const urlWithTrailingSlash = ipfsGatewayUrl.endsWith('/')
    ? ipfsGatewayUrl
    : `${ipfsGatewayUrl}/`;

  return {
    url: urlWithTrailingSlash,
    headers: ipfsGatewaysHeaders,
  };
}
