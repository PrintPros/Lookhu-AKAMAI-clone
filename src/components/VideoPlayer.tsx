import React, { useEffect, useRef } from "react";
import Hls from "hls.js";
import { cn } from "../lib/utils";

interface VideoPlayerProps {
  src: string;
  className?: string;
  muted?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  controls?: boolean;
}

export function VideoPlayer({ 
  src, 
  className, 
  muted = true, 
  autoPlay = true, 
  loop = false, 
  controls = true 
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) {
          video.play().catch(() => {
            console.log("Autoplay blocked, waiting for user interaction");
          });
        }
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // For Safari
      video.src = src;
      video.addEventListener("loadedmetadata", () => {
        if (autoPlay) {
          video.play().catch(() => {
            console.log("Autoplay blocked, waiting for user interaction");
          });
        }
      });
    }
  }, [src]);

  return (
    <video
      ref={videoRef}
      className={cn("w-full h-full object-contain bg-black", className)}
      controls={controls}
      playsInline
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
    />
  );
}
