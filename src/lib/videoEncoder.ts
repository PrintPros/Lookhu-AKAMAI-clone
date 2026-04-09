import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
  });
  return ffmpeg;
}

export async function encodeVideoLocally(file: File, onProgress: (percent: number) => void) {
  const ffmpeg = await loadFFmpeg();
  
  await ffmpeg.writeFile('input.mp4', await fetchFile(file));
  
  ffmpeg.on('progress', ({ progress }) => {
    onProgress(Math.round(progress * 100));
  });

  await ffmpeg.exec([
    '-i', 'input.mp4',
    '-c:v', 'libx264',
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '128k',
    '-af', 'aresample=async=1:first_pts=0',
    '-vf', 'scale=-2:720',
    '-force_key_frames', 'expr:gte(t,n_forced*6)',
    '-crf', '23',
    '-preset', 'fast',
    '-hls_time', '6',
    '-hls_list_size', '0',
    '-hls_segment_filename', 'segment_%04d.ts',
    '-f', 'hls',
    'playlist.m3u8'
  ]);

  const playlist = await ffmpeg.readFile('playlist.m3u8');
  const segments = [];
  const files = await ffmpeg.listDir('.');
  for (const f of files) {
    if (f.name.endsWith('.ts')) {
      segments.push({ name: f.name, data: await ffmpeg.readFile(f.name) });
    }
  }

  return { playlist, segments };
}
