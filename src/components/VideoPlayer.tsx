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
  onError?: (error: any) => void;
}

export function VideoPlayer({ 
  src, 
  className, 
  muted = true, 
  autoPlay = true, 
  loop = false, 
  controls = true,
  onError
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const isHls = src.toLowerCase().includes(".m3u8") || src.includes("workers.dev");

    if (isHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          backBufferLength: 60,
          // Handle codec/audio mismatches at discontinuities
          forceKeyFrameOnDiscontinuity: true,
          // Allow buffer to flush and reset on append errors
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 3,
          // Audio track switching tolerance
          nudgeMaxRetry: 5,
          nudgeOffset: 0.1,
          // Reset buffer on codec change across discontinuity
          startFragPrefetch: false,
        });
        
        hls.loadSource(src);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (autoPlay) {
            video.play().catch(() => {
              console.log("Autoplay blocked, waiting for user interaction");
            });
          }
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          // Handle buffer append errors by doing a full source reload
          if (data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR || data.details === Hls.ErrorDetails.BUFFER_FULL_ERROR) {
            console.log("Buffer append error — reloading source");
            const currentSrc = src;
            hls.destroy();
            setTimeout(() => {
              const newHls = new Hls({
                enableWorker: true,
                backBufferLength: 60,
                forceKeyFrameOnDiscontinuity: true,
                manifestLoadingMaxRetry: 3,
                levelLoadingMaxRetry: 3,
                fragLoadingMaxRetry: 3,
                nudgeMaxRetry: 5,
                nudgeOffset: 0.1,
                startFragPrefetch: false,
              });
              newHls.loadSource(currentSrc);
              newHls.attachMedia(video);
              newHls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play().catch(() => {});
              });
            }, 1000);
            return;
          }

          if (data.fatal) {
            if (onError) onError(data);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log("Fatal network error encountered, trying to recover");
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log("Fatal media error encountered, trying to recover");
                hls.recoverMediaError();
                break;
              default:
                console.log("Fatal error, cannot recover");
                hls.destroy();
                break;
            }
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
    } else {
      // Native MP4 or other supported formats
      video.src = src;
      if (autoPlay) {
        video.play().catch(() => {
          console.log("Autoplay blocked, waiting for user interaction");
        });
      }
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
      referrerPolicy="no-referrer"
    />
  );
}
