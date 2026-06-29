import AudioRecorderPlayer, { AVEncoderAudioQualityIOSType, AVEncodingOption, AudioEncoderAndroidType, AudioSourceAndroidType } from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { MediaRef } from '../types';

// NOTE: react-native-fs is not yet a pinned dep. Fallback: we still expose a
// lighter path using only AudioRecorderPlayer when fs is unavailable.
let fs: typeof RNFS | null = null;
try { fs = require('react-native-fs'); } catch { fs = null; }

export const MAX_VOICE_MS = 120_000; // 2 min cap

class VoiceService {
  private recorder = new AudioRecorderPlayer();
  private recording = false;
  private recordingPath: string | null = null;
  private playingPath: string | null = null;

  async startRecord(onTick?: (ms: number) => void): Promise<void> {
    if (this.recording) return;
    const ext = Platform.OS === 'ios' ? 'm4a' : 'aac';
    const dir = fs ? (Platform.OS === 'ios' ? fs.DocumentDirectoryPath : fs.CachesDirectoryPath) : '';
    const fname = `iimsg-voice-${Date.now()}.${ext}`;
    const path = dir ? `${dir}/${fname}` : fname;
    this.recordingPath = path;
    this.recording = true;

    await this.recorder.startRecorder(path, {
      AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
      AudioSourceAndroid: AudioSourceAndroidType.MIC,
      AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.medium,
      AVFormatIDKeyIOS: AVEncodingOption.aac,
      AVNumberOfChannelsKeyIOS: 1,
      AVSampleRateKeyIOS: 44100,
    });
    this.recorder.addRecordBackListener((e) => {
      onTick?.(e.currentPosition);
      if (e.currentPosition >= MAX_VOICE_MS) { this.stopRecord(); }
    });
  }

  async stopRecord(): Promise<MediaRef | null> {
    if (!this.recording) return null;
    this.recording = false;
    const uri = await this.recorder.stopRecorder();
    this.recorder.removeRecordBackListener();
    const path = this.recordingPath ?? uri;
    if (!fs) return null;
    try {
      const stat = await fs.stat(path);
      const b64 = await fs.readFile(path, 'base64');
      await fs.unlink(path).catch(() => {});
      return {
        mime: Platform.OS === 'ios' ? 'audio/mp4' : 'audio/aac',
        data: b64,
        size: Number(stat.size),
      };
    } catch {
      return null;
    } finally {
      this.recordingPath = null;
    }
  }

  async cancelRecord(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    try { await this.recorder.stopRecorder(); } catch {}
    this.recorder.removeRecordBackListener();
    if (fs && this.recordingPath) await fs.unlink(this.recordingPath).catch(() => {});
    this.recordingPath = null;
  }

  async play(dataUriOrPath: string, onPos?: (ms: number, dur: number) => void, onEnd?: () => void): Promise<void> {
    await this.stopPlay();
    this.playingPath = dataUriOrPath;
    await this.recorder.startPlayer(dataUriOrPath);
    this.recorder.addPlayBackListener((e) => {
      onPos?.(e.currentPosition, e.duration);
      if (e.currentPosition >= e.duration && e.duration > 0) {
        this.stopPlay().catch(() => {});
        onEnd?.();
      }
    });
  }

  async stopPlay(): Promise<void> {
    if (!this.playingPath) return;
    try { await this.recorder.stopPlayer(); } catch {}
    this.recorder.removePlayBackListener();
    this.playingPath = null;
  }

  isRecording(): boolean { return this.recording; }
}

export const voice = new VoiceService();
