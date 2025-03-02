import { Carousel } from "react-responsive-carousel";
import "react-responsive-carousel/lib/styles/carousel.min.css"; // requires a loader
import blockscoutSS from "../../assets/integrations/blockscout-screenshot.png";
import hardhat from "../../assets/integrations/hardhat.gif";
import remix from "../../assets/integrations/remix.gif";

const CustomCarousel = () => {
  return (
    <Carousel
      infiniteLoop
      autoPlay
      interval={5000}
      showThumbs={false}
      showStatus={false}
    >
      {
        // Pass an array of Elements to Carousel
        [
          <img
            src={blockscoutSS}
            className="h-[30rem]"
            style={{ width: "auto" }}
            alt="Blockscout screenshot"
          />,
          <img
            src={hardhat}
            className="h-[30rem]"
            // className="px-12 max-h-48 h-auto w-auto"
            style={{ width: "auto" }}
            alt="Hardhat verification GIF"
          />,
          <div className="flex justify-center items-center w-full h-full">
            <img
              src={remix}
              className="h-[24rem]"
              // className="px-12 max-h-48 h-auto w-auto"
              style={{ width: "auto" }}
              alt="Remix verification GIF"
            />
          </div>,
        ]
      }
    </Carousel>
  );
};

export default CustomCarousel;
