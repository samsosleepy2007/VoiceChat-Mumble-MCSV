package se.lublin.humla.audio;

import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/** Owns communication routing for the lifetime of one voice connection. */
public final class SpeakerAudioRoute {
    public static final String PREF_OUTPUT = "vc_audio_output";
    private static final String TAG = "SleepyMumlaAudioRoute";
    private final AudioManager manager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private AudioDeviceCallback callback;
    private AudioManager.OnCommunicationDeviceChangedListener communicationListener;
    private AudioTrack.OnRoutingChangedListener trackListener;
    private AudioTrack track;
    private boolean started, closed, selected, legacyChanged, previousSpeaker;
    private AudioDeviceInfo previousCommunicationDevice;
    private String policy = "auto";
    private int retries;
    private String status = "Waiting for playback";
    private final Runnable verify = () -> update(false);

    public SpeakerAudioRoute(AudioManager manager) { this.manager = manager; }

    public static int preferredDeviceType(int[] available) {
        int[] priority = {AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE,
                AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_HEARING_AID,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_SPEAKER,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER};
        for (int type : priority) for (int candidate : available) if (candidate == type) return type;
        return 0;
    }

    /** A disconnected explicit choice falls back to auto, without forgetting the choice. */
    public static int chooseDeviceType(String policy, int[] available) {
        try {
            int type = Integer.parseInt(policy);
            for (int candidate : available) if (candidate == type) return type;
        } catch (NumberFormatException ignored) { }
        return preferredDeviceType(available);
    }

    public synchronized AudioDeviceInfo[] getDevices() {
        if (Build.VERSION.SDK_INT >= 31)
            return manager.getAvailableCommunicationDevices().toArray(new AudioDeviceInfo[0]);
        if (Build.VERSION.SDK_INT >= 23) return manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        return new AudioDeviceInfo[0];
    }

    public synchronized void start() {
        previousSpeaker = manager.isSpeakerphoneOn();
        if (Build.VERSION.SDK_INT >= 31) previousCommunicationDevice = manager.getCommunicationDevice();
        started = true;
        if (Build.VERSION.SDK_INT >= 23) {
            callback = new AudioDeviceCallback() {
                @Override public void onAudioDevicesAdded(AudioDeviceInfo[] devices) { update(true); }
                @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] devices) { update(true); }
            };
            manager.registerAudioDeviceCallback(callback, handler);
        }
        if (Build.VERSION.SDK_INT >= 31) {
            communicationListener = device -> update(false);
            manager.addOnCommunicationDeviceChangedListener(command -> handler.post(command), communicationListener);
        }
        update(true);
    }

    public synchronized void setPolicy(String value) { policy = value; update(true); }

    public synchronized void attach(AudioTrack output) {
        track = output;
        if (Build.VERSION.SDK_INT >= 23) {
            trackListener = audioTrack -> update(false);
            track.addOnRoutingChangedListener(trackListener, handler);
        }
        update(true);
    }

    public synchronized void onPlaybackStarted() {
        if (closed) return;
        // Verify after play/write has made the real route visible. Never retry indefinitely.
        retries = 3;
        handler.removeCallbacks(verify);
        handler.postDelayed(verify, 250);
    }

    public synchronized AudioDeviceInfo getRoutedDevice() {
        return !closed && track != null && Build.VERSION.SDK_INT >= 23 ? track.getRoutedDevice() : null;
    }

    public synchronized String getStatus() { return status; }

    private synchronized void update(boolean reset) {
        if (closed || !started) return;
        if (reset) retries = 3;
        AudioDeviceInfo[] devices = getDevices();
        int[] types = new int[devices.length];
        for (int i = 0; i < devices.length; i++) types[i] = devices[i].getType();
        int preferred = chooseDeviceType(policy, types);
        AudioDeviceInfo target = null;
        for (AudioDeviceInfo device : devices) if (device.getType() == preferred) { target = device; break; }
        AudioDeviceInfo routed = getRoutedDevice();
        boolean actualMismatch = target != null && routed != null && routed.getId() != target.getId();
        boolean accepted = true;
        if (Build.VERSION.SDK_INT >= 31 && target != null) {
            AudioDeviceInfo current = manager.getCommunicationDevice();
            if (actualMismatch || current == null || current.getId() != target.getId()) {
                if (retries > 0) {
                    accepted = manager.setCommunicationDevice(target);
                    selected |= accepted;
                } else accepted = false;
            }
        } else if (Build.VERSION.SDK_INT < 31) {
            boolean external = manager.isWiredHeadsetOn() || manager.isBluetoothScoOn() || manager.isBluetoothA2dpOn();
            boolean speaker = preferred == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    || (preferred == 0 && !external && !"1".equals(policy));
            if (manager.isSpeakerphoneOn() != speaker && retries > 0) {
                manager.setSpeakerphoneOn(speaker);
                legacyChanged = true;
            }
        }
        if (Build.VERSION.SDK_INT >= 23 && track != null && retries > 0) {
            AudioDeviceInfo old = track.getPreferredDevice();
            if (actualMismatch || (old == null && target != null) || (old != null && (target == null || old.getId() != target.getId())))
                accepted &= track.setPreferredDevice(target);
        }
        AudioDeviceInfo actual = getRoutedDevice();
        boolean mismatch = target != null && actual != null && actual.getId() != target.getId();
        status = "requested=" + policy + " targetType=" + preferred + " accepted=" + accepted
                + " actualType=" + (actual == null ? "unknown" : actual.getType()) + " retries=" + retries;
        Log.i(TAG, status);
        handler.removeCallbacks(verify);
        if (retries > 0) {
            retries--;
            if (!accepted || mismatch || actual == null) handler.postDelayed(verify, 500);
        }
    }

    public synchronized void close() {
        if (closed) return;
        closed = true;
        handler.removeCallbacksAndMessages(null);
        if (Build.VERSION.SDK_INT >= 23 && callback != null) manager.unregisterAudioDeviceCallback(callback);
        if (Build.VERSION.SDK_INT >= 23 && track != null && trackListener != null)
            track.removeOnRoutingChangedListener(trackListener);
        track = null;
        if (Build.VERSION.SDK_INT >= 31) {
            if (communicationListener != null) manager.removeOnCommunicationDeviceChangedListener(communicationListener);
            if (selected) {
                boolean restored = false;
                if (previousCommunicationDevice != null) for (AudioDeviceInfo device : getDevices())
                    if (device.getId() == previousCommunicationDevice.getId()) restored = manager.setCommunicationDevice(device);
                if (!restored) manager.clearCommunicationDevice();
            }
        } else if (legacyChanged) manager.setSpeakerphoneOn(previousSpeaker);
    }
}
