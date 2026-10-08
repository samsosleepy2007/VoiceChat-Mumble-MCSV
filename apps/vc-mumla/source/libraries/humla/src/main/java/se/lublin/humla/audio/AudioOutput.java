/*
 * Copyright (C) 2014 Andrew Comminos
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

package se.lublin.humla.audio;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.util.Log;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

import se.lublin.humla.exception.AudioInitializationException;
import se.lublin.humla.exception.NativeAudioException;
import se.lublin.humla.model.TalkState;
import se.lublin.humla.model.User;
import se.lublin.humla.net.HumlaUDPMessageType;
import se.lublin.humla.net.PacketBuffer;
import se.lublin.humla.protocol.AudioHandler;

/**
 * Created by andrew on 16/07/13.
 */
public class AudioOutput implements Runnable, AudioOutputSpeech.TalkStateListener {
    private static final String TAG = AudioOutput.class.getName();

    private Map<Integer, AudioOutputSpeech> mAudioOutputs = new HashMap<>();
    private AudioTrack mAudioTrack;
    private int mBufferSize;
    private Thread mThread;
    private final Object mInactiveLock = new Object(); // Lock that the audio thread waits on when there's no audio to play. Wake when we get a frame.
    private final Lock mPacketLock;
    private volatile boolean mRunning = false;
    private final LocalAudioTest mLocalTest = new LocalAudioTest(AudioHandler.SAMPLE_RATE);
    private SpeakerAudioRoute mRoute;
    private Handler mMainHandler;
    private AudioOutputListener mListener;
    private final IAudioMixer<float[], short[]> mMixer;
    private ExecutorService mDecodeExecutorService;
    private long mVcLastGainLogMs = 0L; // VC_GAIN_DIAGNOSTIC

    public AudioOutput(AudioOutputListener listener) {
        mListener = listener;
        mMainHandler = new Handler(Looper.getMainLooper());
        mDecodeExecutorService = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());
        mPacketLock = new ReentrantLock();
        mMixer = new BasicClippingShortMixer();
    }

    public void setRoute(SpeakerAudioRoute route) { mRoute = route; }
    public synchronized android.media.AudioDeviceInfo getRoutedDevice() {
        return mRoute == null ? null : mRoute.getRoutedDevice();
    }
    public boolean startAudioTest() {
        if (!mRunning) return false;
        synchronized (mInactiveLock) {
            mLocalTest.start();
            mInactiveLock.notifyAll();
        }
        return true;
    }
    public void stopAudioTest() { mLocalTest.stop(); }
    public boolean isAudioTestPlaying() { return mLocalTest.isPlaying(); }

    public Thread startPlaying(int audioStream) throws AudioInitializationException {
        if (mThread != null || mRunning)
            return null;

        int minBufferSize = AudioTrack.getMinBufferSize(AudioHandler.SAMPLE_RATE,
                AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        mBufferSize = Math.max((minBufferSize + 1) / 2, AudioHandler.FRAME_SIZE * 2);
        Log.v(TAG, "Using buffer size " + mBufferSize + ", system's min buffer size: " + minBufferSize);

        try {
            if (Build.VERSION.SDK_INT >= 23) {
                // Attributes, not a legacy stream type, let the communication route own the output.
                boolean voice = audioStream == AudioManager.STREAM_VOICE_CALL;
                mAudioTrack = new AudioTrack.Builder()
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(voice ? AudioAttributes.USAGE_VOICE_COMMUNICATION : AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build())
                        .setAudioFormat(new AudioFormat.Builder()
                                .setSampleRate(AudioHandler.SAMPLE_RATE)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .build())
                        .setBufferSizeInBytes(mBufferSize * 2) // Capacity is bytes; the mixer counts PCM16 samples.
                        .setTransferMode(AudioTrack.MODE_STREAM)
                        .build();
            } else {
                mAudioTrack = new AudioTrack(audioStream,
                        AudioHandler.SAMPLE_RATE,
                        AudioFormat.CHANNEL_OUT_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        mBufferSize * 2, // AudioTrack capacity is bytes; the mixer counts PCM16 samples.
                        AudioTrack.MODE_STREAM);
            }
        } catch (IllegalArgumentException | UnsupportedOperationException e) {
            throw new AudioInitializationException(e);
        }

        if (mRoute != null) mRoute.attach(mAudioTrack);
        mRunning = true;
        mThread = new Thread(this);
        mThread.start();
        return mThread;
    }

    public void stopPlaying() {
        if(!mRunning)
            return;

        mLocalTest.stop();
        mRunning = false;
        synchronized (mInactiveLock) {
            mInactiveLock.notify(); // Wake inactive lock if active
        }
        try {
            mThread.join();
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
        mThread = null;

        mPacketLock.lock();
        for(AudioOutputSpeech speech : mAudioOutputs.values()) {
            speech.destroy();
        }
        mPacketLock.unlock();

        mAudioOutputs.clear();
        if (mRoute != null) mRoute.close();
        mAudioTrack.release();
        mAudioTrack = null;
    }

    public boolean isPlaying() {
        return mRunning;
    }

    @Override
    public void run() {
        Log.v(TAG, "Started thread.");
        android.os.Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        mAudioTrack.play();
        if (mRoute != null) mRoute.onPlaybackStarted();

        final short[] mix = new short[mBufferSize];

        while(mRunning) {
            if(fetchAudio(mix, 0, mBufferSize)) {
                mAudioTrack.write(mix, 0, mBufferSize);
            } else {
                Log.v(TAG, "Pausing thread.");
                synchronized (mInactiveLock) {
                    if (!mRunning || mLocalTest.isPlaying() || hasQueuedAudio()) continue;
                    mAudioTrack.flush();
                    mAudioTrack.pause();

                    try {
                        mInactiveLock.wait();
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }

                    if (mRunning) {
                        mAudioTrack.play();
                        if (mRoute != null) mRoute.onPlaybackStarted();
                    }
                }
                Log.v(TAG, "Resuming thread.");
            }
        }

        mAudioTrack.flush();
        mAudioTrack.stop();
    }

    /**
     * Fetches audio data from registered audio output users and mixes them into the given buffer.
     * TODO: add priority speaker support.
     * @param buffer The buffer to mix output data into.
     * @param bufferOffset The offset of the
     * @param bufferSize The size of the buffer.
     * @return true if the buffer contains audio data.
     */
    private boolean fetchAudio(short[] buffer, int bufferOffset, int bufferSize) {
        Arrays.fill(buffer, bufferOffset, bufferOffset + bufferSize, (short) 0);
        final List<IAudioMixerSource<float[]>> sources = new ArrayList<>();
        try {
            mPacketLock.lock();
            // Parallelize decoding using a fixed thread pool equal to the number of cores
            List<Future<AudioOutputSpeech.Result>> futureResults =
                    mDecodeExecutorService.invokeAll(mAudioOutputs.values());
            for(Future<AudioOutputSpeech.Result> future : futureResults) {
                AudioOutputSpeech.Result result = future.get();
                if (result.isAlive()) {
                    sources.add(result);
                } else {
                    AudioOutputSpeech speech = result.getSpeechOutput();
                    Log.v(TAG, "Deleted audio user " + speech.getUser().getName());
                    mAudioOutputs.remove(speech.getSession());
                    speech.destroy();
                }
            }
        } catch (InterruptedException e) {
            e.printStackTrace();
            return false;
        } catch (ExecutionException e) {
            e.printStackTrace();
            return false;
        } finally {
            mPacketLock.unlock();
        }

        if (!sources.isEmpty()) mMixer.mix(sources, buffer, bufferOffset, bufferSize);
        boolean test = mLocalTest.mix(buffer, bufferOffset, bufferSize);
        return test || !sources.isEmpty();
    }

    private boolean hasQueuedAudio() {
        mPacketLock.lock();
        try { return !mAudioOutputs.isEmpty(); }
        finally { mPacketLock.unlock(); }
    }

    public void queueVoiceData(byte[] data, HumlaUDPMessageType messageType) {
        if(!mRunning)
            return;

        byte msgFlags = (byte) (data[0] & 0x1f);
        PacketBuffer pds = new PacketBuffer(data, data.length);
        pds.skip(1);
        int session = (int) pds.readLong();
        User user = mListener.getUser(session);
        if(user != null && !user.isLocalMuted()) {
            // TODO check for whispers here
            int seq = (int) pds.readLong();

            // Synchronize so we don't destroy an output while we add a buffer to it.
            mPacketLock.lock();
            AudioOutputSpeech aop = mAudioOutputs.get(session);
            if(aop != null && aop.getCodec() != messageType) {
                aop.destroy();
                aop = null;
            }
            if(aop == null) {
                try {
                    aop = new AudioOutputSpeech(user, messageType, mBufferSize, this);
                } catch (NativeAudioException e) {
                    Log.v(TAG, "Failed to create audio user " + user.getName());
                    e.printStackTrace();
                    return;
                }
                Log.v(TAG, "Created audio user " + user.getName());
                mAudioOutputs.put(session, aop);
            }
            mPacketLock.unlock();

            byte[] vcVoicePayload = pds.dataBlock(pds.left());
            float vcServerGain = 1.0f; // VC_GAIN_TRAILER
            boolean vcHasGainTrailer = false;
            if (vcVoicePayload.length >= 8) {
                int vcOffset = vcVoicePayload.length - 8;
                if (vcVoicePayload[vcOffset] == 'V'
                        && vcVoicePayload[vcOffset + 1] == 'C'
                        && vcVoicePayload[vcOffset + 2] == 'G'
                        && vcVoicePayload[vcOffset + 3] == '1') {
                    int vcBits = (vcVoicePayload[vcOffset + 4] & 0xff)
                            | ((vcVoicePayload[vcOffset + 5] & 0xff) << 8)
                            | ((vcVoicePayload[vcOffset + 6] & 0xff) << 16)
                            | ((vcVoicePayload[vcOffset + 7] & 0xff) << 24);
                    float vcCandidate = Float.intBitsToFloat(vcBits);
                    if (Float.isFinite(vcCandidate) && vcCandidate >= 0.0f && vcCandidate <= 1.0f) {
                        vcServerGain = vcCandidate;
                        vcHasGainTrailer = true;
                        vcVoicePayload = Arrays.copyOf(vcVoicePayload, vcOffset);
                    }
                }
            }

            long vcNow = System.currentTimeMillis();
            if (vcNow - mVcLastGainLogMs >= 2000L) {
                mVcLastGainLogMs = vcNow;
                Log.i(TAG, "VC-GAIN rx session=" + session
                        + " gain=" + vcServerGain
                        + " trailer=" + vcHasGainTrailer
                        + " payloadBytes=" + vcVoicePayload.length);
            }

            PacketBuffer dataBuffer = new PacketBuffer(vcVoicePayload, vcVoicePayload.length);
            aop.addFrameToBuffer(dataBuffer, msgFlags, seq, vcServerGain);

            synchronized (mInactiveLock) {
                mInactiveLock.notify();
            }
        }

    }

    @Override
    public void onTalkStateUpdated(final int session, final TalkState state) {
        mMainHandler.post(new Runnable() {
            @Override
            public void run() {
                final User user = mListener.getUser(session);
                if(user != null && user.getTalkState() != state) {
                    user.setTalkState(state);
                    mListener.onUserTalkStateUpdated(user);
                }
            }
        });
    }

    public static interface AudioOutputListener {
        /**
         * Called when a user's talking state is changed.
         * @param user The user whose talking state has been modified.
         */
        public void onUserTalkStateUpdated(User user);

        /**
         * Used to set audio-related user data.
         * @return The user for the associated session.
         */
        public User getUser(int session);
    }
}
