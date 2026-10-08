package se.lublin.humla.audio;

import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

/**
 * Owns communication routing for the lifetime of one voice connection.
 *
 * Exactly one routing mechanism is used per platform level: the communication device on
 * API 31+, speakerphone below. Combining either with AudioTrack.setPreferredDevice makes some
 * audio policies open both the earpiece and the loudspeaker at once.
 */
public final class SpeakerAudioRoute {
    public static final String PREF_OUTPUT = "vc_audio_output";
    private static final String TAG = "SleepyMumlaAudioRoute";
    private static final long DEBOUNCE_MS = 300;
    private static final long MIN_INTERVAL_MS = 1000;
    private final AudioManager manager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private AudioDeviceCallback callback;
    private AudioManager.OnCommunicationDeviceChangedListener communicationListener;
    private AudioTrack.OnRoutingChangedListener trackListener;
    private AudioTrack track;
    private boolean started, closed, selected, legacyChanged, previousSpeaker;
    private AudioDeviceInfo previousCommunicationDevice;
    private String policy = "auto";
    private long lastApplied;
    private String status = "Waiting for playback";
    private final Runnable apply = this::update;

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

    /**
     * Legacy (API < 31) speakerphone decision: loudspeaker unless an external device is
     * connected or the earpiece was requested explicitly.
     */
    public static boolean legacySpeakerphone(String policy, int preferred, boolean external) {
        if ("1".equals(policy)) return false;
        return preferred == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER || (preferred == 0 && !external);
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
                @Override public void onAudioDevicesAdded(AudioDeviceInfo[] devices) { schedule(); }
                @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] devices) { schedule(); }
            };
            manager.registerAudioDeviceCallback(callback, handler);
        }
        if (Build.VERSION.SDK_INT >= 31) {
            communicationListener = device -> schedule();
            manager.addOnCommunicationDeviceChangedListener(command -> handler.post(command), communicationListener);
        }
        // Select the route before the track exists so playback opens on the right output.
        update();
    }

    public synchronized void setPolicy(String value) { policy = value; lastApplied = 0; update(); }

    public synchronized void attach(AudioTrack output) {
        track = output;
        if (Build.VERSION.SDK_INT >= 23) {
            // Clear any per-track override; the communication route alone decides the output.
            track.setPreferredDevice(null);
            trackListener = audioTrack -> schedule();
            track.addOnRoutingChangedListener(trackListener, handler);
        }
        update();
    }

    public synchronized void onPlaybackStarted() { schedule(); }

    public synchronized AudioDeviceInfo getRoutedDevice() {
        return !closed && track != null && Build.VERSION.SDK_INT >= 23 ? track.getRoutedDevice() : null;
    }

    public synchronized String getStatus() { return status; }

    /** Re-assert after route changes, debounced and rate limited so we never fight the system in a loop. */
    private synchronized void schedule() {
        if (closed || !started) return;
        handler.removeCallbacks(apply);
        long wait = Math.max(DEBOUNCE_MS, lastApplied + MIN_INTERVAL_MS - SystemClock.uptimeMillis());
        handler.postDelayed(apply, wait);
    }

    private synchronized void update() {
        if (closed || !started) return;
        lastApplied = SystemClock.uptimeMillis();
        AudioDeviceInfo[] devices = getDevices();
        int[] types = new int[devices.length];
        for (int i = 0; i < devices.length; i++) types[i] = devices[i].getType();
        int preferred = chooseDeviceType(policy, types);
        AudioDeviceInfo target = null;
        for (AudioDeviceInfo device : devices) if (device.getType() == preferred) { target = device; break; }
        boolean accepted = true;
        if (Build.VERSION.SDK_INT >= 31) {
            AudioDeviceInfo current = manager.getCommunicationDevice();
            if (target != null && (current == null || current.getId() != target.getId())) {
                accepted = manager.setCommunicationDevice(target);
                selected |= accepted;
                if (!accepted && preferred == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    // Some vendors reject the device but still honour the legacy switch.
                    manager.setSpeakerphoneOn(true);
                    legacyChanged = true;
                }
            }
        } else {
            boolean external = manager.isWiredHeadsetOn() || manager.isBluetoothScoOn() || manager.isBluetoothA2dpOn();
            boolean speaker = legacySpeakerphone(policy, preferred, external);
            if (manager.isSpeakerphoneOn() != speaker) {
                manager.setSpeakerphoneOn(speaker);
                legacyChanged = true;
            }
        }
        AudioDeviceInfo communication = Build.VERSION.SDK_INT >= 31 ? manager.getCommunicationDevice() : null;
        AudioDeviceInfo actual = getRoutedDevice();
        status = "requested=" + policy + " targetType=" + preferred + " accepted=" + accepted
                + " commDevice=" + (communication == null ? "none" : communication.getType())
                + " speakerphone=" + manager.isSpeakerphoneOn()
                + " actualType=" + (actual == null ? "unknown" : actual.getType());
        Log.i(TAG, status);
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
        }
        if (legacyChanged) manager.setSpeakerphoneOn(previousSpeaker);
    }
}
