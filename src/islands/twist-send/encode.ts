/**
 * Turns the Twist & send scene into a video file, frame by frame (never real-time, so a slow
 * phone makes the same smooth 30fps video, just more slowly). MP4 (H.264 + AAC) where the
 * browser can encode it, WebM (VP9/VP8 + Opus) otherwise, and MediaRecorder as a last resort.
 */
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from 'mediabunny';
import { getContext, render } from '../../shared/sound.ts';
import { cues, DURATION, FPS } from './scene.ts';

export interface Made {
  blob: Blob;
  ext: 'mp4' | 'webm';
}

type Draw = (ctx: CanvasRenderingContext2D, t: number) => void;

async function mixAudio(): Promise<AudioBuffer | null> {
  try {
    getContext(); // builds the shared noise buffer the sounds use
    const rate = 48000;
    const off = new OfflineAudioContext(2, Math.ceil(DURATION * rate), rate);
    const bus = off.createGain();
    bus.gain.value = 0.9;
    bus.connect(off.destination);
    for (const c of cues()) render(c.name, { ctx: off, dest: bus }, c.at, c.name === 'click' ? 0.6 : 1);
    return await off.startRendering();
  } catch {
    return null;
  }
}

export async function makeVideo(width: number, height: number, draw: Draw, withSound: boolean, progress: (p: number) => void): Promise<Made> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const frames = Math.round(DURATION * FPS);

  const mp4Codec = typeof VideoEncoder === 'undefined' ? null : await getFirstEncodableVideoCodec(['avc'], { width, height });
  const webmCodec = mp4Codec || typeof VideoEncoder === 'undefined' ? null : await getFirstEncodableVideoCodec(['vp9', 'vp8'], { width, height });
  const codec = mp4Codec ?? webmCodec;
  if (!codec) return record(canvas, ctx, draw, frames, progress);

  const ext = mp4Codec ? 'mp4' : 'webm';
  const output = new Output({
    format: mp4Codec ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: FPS });

  const audioCodec = mp4Codec ? 'aac' : 'opus';
  const audio = withSound && (await canEncodeAudio(audioCodec)) ? await mixAudio() : null;
  const audioSource = audio ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();
  if (audioSource && audio) await audioSource.add(audio);
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    draw(ctx, t);
    await video.add(t, 1 / FPS);
    if (i % 5 === 0) progress(i / frames);
  }
  await output.finalize();
  progress(1);
  const buffer = (output.target as BufferTarget).buffer!;
  return { blob: new Blob([buffer], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }), ext };
}

/** No WebCodecs: play the scene in real time into MediaRecorder (silent, WebM or MP4). */
function record(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, draw: Draw, frames: number, progress: (p: number) => void): Promise<Made> {
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported?.(m));
  if (!type || typeof canvas.captureStream !== 'function') return Promise.reject(new Error('no encoder'));
  const stream = canvas.captureStream(FPS);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  return new Promise((resolve, reject) => {
    rec.onstop = () => resolve({ blob: new Blob(chunks, { type }), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' });
    rec.onerror = () => reject(new Error('recorder'));
    draw(ctx, 0);
    rec.start();
    const start = performance.now();
    const step = () => {
      const t = (performance.now() - start) / 1000;
      draw(ctx, Math.min(t, frames / FPS));
      progress(Math.min(1, t / (frames / FPS)));
      if (t < frames / FPS) requestAnimationFrame(step);
      else rec.stop();
    };
    requestAnimationFrame(step);
  });
}
