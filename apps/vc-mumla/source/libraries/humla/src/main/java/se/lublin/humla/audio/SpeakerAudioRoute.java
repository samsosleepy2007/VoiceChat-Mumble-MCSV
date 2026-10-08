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
 * Chooses and reports where voice playback is routed for one voice connection.
 *
 * Call mode (the default) plays voice like a phone call on speakerphone. Phones with a
 * stereo earpiece only use the bottom loudspeaker for speakerphone, so voice comes from
 * one speaker. Exactly one routing mechanism is used: the communication device on API 31+,
 * the speakerphone switch below. It never sets a per-track preferred device, and never
 * falls back from one mechanism to the other; mixing them makes some audio policies open
 * the earpiece and the loudspeaker together. The earpiece itself is never selected.
 *
 * Media mode plays voice like a music app and changes no routing at all. On stereo-speaker
 * phones that uses both the earpiece and the loudspeaker; it is kept as a fallback.
 */
public final class SpeakerAudioRoute {
    public static final String PREF_OUTPUT = "vc_audio_output";
    public static final String MODE_CALL = "call";
    public static final String MODE_MEDIA = "media";
    private static final String TAG = "SleepyMumlaAudioRoute";
    private static final long DEBOUNCE_MS = 300;
    private static final long MIN_INTERVAL_MS = 1000;
    private final AudioManager manager;
    private final boolean call;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable apply = this::update;
    private AudioDeviceCallback deviceCallback;
    private AudioManager.OnCommunicationDeviceChangedListener communicationListener;
    private AudioTrack.OnRoutingChangedListener trackListener;
    private AudioTrack track;
    private boolean started, closed, selectedDevice, changedSpeakerphone, previousSpeakerphone;
    private long lastApplied;
    private int targetType;
    private String status;

    public SpeakerAudioRoute(AudioManager manager, boolean call) {
        this.manager = manager;
        this.call = call;
        status = statusLine(getMode(), 0, 0);
    }

    public String getMode() { return call ? MODE_CALL : MODE_MEDIA; }

    /** Status line shown in logs; device types are 0 when none or not yet known. */
    public static String statusLine(String mode, int targetType, int routedType) {
        StringBuilder line = new StringBuilder("mode=").append(mode);
        if (MODE_CALL.equals(mode)) line.append(" target=").append(typeName(targetType));
        return line.append(" actual=").append(typeName(routedType)).toString();
    }

    private static String typeName(int type) { return type == 0 ? "unknown" : Integer.toString(type); }

    /**
     * Call mode output, most preferred first: any headset, otherwise the loudspeaker.
     * The earpiece is deliberately absent. Returns 0 when nothing usable is available.
     */
    public static int chooseCallDeviceType(int[] available) {
        int[] priority = {AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE,
                AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_HEARING_AID,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER};
        for (int type : priority) for (int candidate : available) if (candidate == type) return type;
        return 0;
    }

    /** API < 31: loudspeaker unless a wired headset or a Bluetooth SCO link carries the call. */
    public static boolean legacySpeakerphone(boolean wiredHeadset, boolean bluetoothSco) {
        return !wiredHeadset && !bluetoothSco;
    }

    public synchronized AudioDeviceInfo[] getDevices() {
        if (Build.VERSION.SDK_INT >= 23) return manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        return new AudioDeviceInfo[0];
    }

    /** Selects the route before the track exists, so playback opens on the right output. */
    public synchronized void start() {
        if (started || closed) return;
        started = true;
        if (call) {
            previousSpeakerphone = manager.isSpeakerphoneOn();
            if (Build.VERSION.SDK_INT >= 23) {
                deviceCallback = new AudioDeviceCallback() {
                    @Override public void onAudioDevicesAdded(AudioDeviceInfo[] devices) { schedule(); }
                    @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] devices) { schedule(); }
                };
                manager.registerAudioDeviceCallback(deviceCallback, handler);
            }
            if (Build.VERSION.SDK_INT >= 31) {
                communicationListener = device -> schedule();
                manager.addOnCommunicationDeviceChangedListener(handler::post, communicationListener);
            }
        }
        update();
    }

    /** Output selection was removed with the earpiece path; kept so callers stay compatible. */
    public synchronized void setPolicy(String value) { }

    public synchronized void attach(AudioTrack output) {
        track = output;
        if (Build.VERSION.SDK_INT >= 23) {
            trackListener = audioTrack -> report();
            track.addOnRoutingChangedListener(trackListener, handler);
        }
        report();
    }

    public synchronized void onPlaybackStarted() { handler.postDelayed(this::report, 250); }

    public synchronized AudioDeviceInfo getRoutedDevice() {
        return !closed && track != null && Build.VERSION.SDK_INT >= 23 ? track.getRoutedDevice() : null;
    }

    public synchronized String getStatus() { return status; }

    /** Re-select after device changes, debounced and rate limited so we never fight the system in a loop. */
    private synchronized void schedule() {
        if (closed || !started) return;
        handler.removeCallbacks(apply);
        long wait = Math.max(DEBOUNCE_MS, lastApplied + MIN_INTERVAL_MS - SystemClock.uptimeMillis());
        handler.postDelayed(apply, wait);
    }

    private synchronized void update() {
        if (closed || !started) return;
        lastApplied = SystemClock.uptimeMillis();
        if (call) {
            if (Build.VERSION.SDK_INT >= 31) selectCommunicationDevice();
            else selectSpeakerphone();
        }
        report();
    }

    private void selectCommunicationDevice() {
        AudioDeviceInfo[] devices = manager.getAvailableCommunicationDevices().toArray(new AudioDeviceInfo[0]);
        int[] types = new int[devices.length];
        for (int i = 0; i < devices.length; i++) types[i] = devices[i].getType();
        targetType = chooseCallDeviceType(types);
        AudioDeviceInfo target = null;
        for (AudioDeviceInfo device : devices) if (device.getType() == targetType) { target = device; break; }
        AudioDeviceInfo current = manager.getCommunicationDevice();
        if (target == null || (current != null && current.getId() == target.getId())) return;
        boolean accepted = manager.setCommunicationDevice(target);
        selectedDevice |= accepted;
        if (!accepted) Log.w(TAG, "setCommunicationDevice rejected type=" + targetType);
    }

    private void selectSpeakerphone() {
        boolean speaker = legacySpeakerphone(manager.isWiredHeadsetOn(), manager.isBluetoothScoOn());
        targetType = speaker ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : 0;
        if (manager.isSpeakerphoneOn() != speaker) {
            manager.setSpeakerphoneOn(speaker);
            changedSpeakerphone = true;
        }
    }

    private synchronized void report() {
        if (closed) return;
        AudioDeviceInfo actual = getRoutedDevice();
        status = statusLine(getMode(), targetType, actual == null ? 0 : actual.getType());
        Log.i(TAG, status);
    }

    /** Releases the route. Call before restoring the audio mode. */
    public synchronized void close() {
        if (closed) return;
        closed = true;
        handler.removeCallbacksAndMessages(null);
        if (Build.VERSION.SDK_INT >= 23 && track != null && trackListener != null)
            track.removeOnRoutingChangedListener(trackListener);
        track = null;
        if (Build.VERSION.SDK_INT >= 23 && deviceCallback != null)
            manager.unregisterAudioDeviceCallback(deviceCallback);
        if (Build.VERSION.SDK_INT >= 31) {
            if (communicationListener != null)
                manager.removeOnCommunicationDeviceChangedListener(communicationListener);
            if (selectedDevice) manager.clearCommunicationDevice();
        }
        if (changedSpeakerphone) manager.setSpeakerphoneOn(previousSpeakerphone);
    }
}
