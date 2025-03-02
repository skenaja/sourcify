import { Link } from "react-router-dom";
import ReactTooltip from "react-tooltip";
import { ReactComponent as Github } from "../../assets/icons/github.svg";
import { ReactComponent as Matrix } from "../../assets/icons/matrix.svg";
import { ReactComponent as Twitter } from "../../assets/icons/twitter.svg";
import logoText from "../../assets/logo-rounded.svg";
import { DOCS_URL } from "../../constants";

const Header = () => {
  return (
    <header className="flex justify-between py-4 md:py-6 w-auto">
      <ReactTooltip effect="solid" />
      <div>
        <Link to="/" className="flex items-center">
          <img
            src={logoText}
            alt="Sourcify logo"
            className="max-h-8 md:max-h-10"
          />
          <span className="ml-3 text-gray-700 font-vt323 text-xl md:text-2xl">
            sourcify.eth
          </span>
        </Link>
      </div>
      <div className="flex items-center">
        <nav className="font-vt323 text-lg md:text-2xl text-gray-700">
          <Link
            className="link-underline mx-2 my-2 md:mx-6 hover:text-ceruleanBlue-500"
            to="/verifier"
          >
            Verify
          </Link>
          <Link
            className="link-underline mx-2 my-2 md:mx-6 hover:text-ceruleanBlue-500"
            to="/lookup"
          >
            Lookup
          </Link>
          <a
            className="link-underline mx-2 my-2 md:mx-6 hover:text-ceruleanBlue-500"
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
          >
            Docs
          </a>
        </nav>
        {/* Icons */}
        <div className="flex items-center md:ml-8">
          <a
            className="px-2 hover-to-fill"
            href="https://github.com/ethereum/sourcify"
            target="_blank"
            rel="noreferrer"
            data-tip="Github"
          >
            <Github className="h-4 md:h-6 w-auto fill-gray-700 " />
          </a>
          <a
            className="px-2 hover-to-fill"
            href="https://twitter.com/sourcifyeth"
            target="_blank"
            rel="noreferrer"
            data-tip="Twitter"
          >
            <Twitter className="h-[0.95rem] md:h-[1.4rem] w-auto fill-gray-700 500" />
          </a>
          <a
            className="pl-2 hover-to-fill"
            href="https://matrix.to/#/#ethereum_source-verify:gitter.im"
            target="_blank"
            rel="noreferrer"
            data-tip="Matrix chat"
          >
            <Matrix className="h-4 md:h-6 w-auto fill-gray-700 hover:fill-ceruleanBlue-500" />
          </a>
        </div>
        <Link
          className="link-underline mx-2 my-2 md:mx-6 hover:text-ceruleanBlue-500"
          to="/status"
          data-tip="Server status: working"
        >
          ✅
        </Link>
      </div>
    </header>
  );
};

export default Header;
