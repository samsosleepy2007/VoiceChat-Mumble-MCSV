package se.lublin.humla.audio;

import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/** Speaker by default for system AEC, while respecting external audio devices. */
public final class SpeakerAudioRoute {
    private static final String TAG = "SleepyMumlaAudioRoute";
    private final AudioManager manager;
    private AudioDeviceCallback callback;
    private boolean closed;
    private boolean selected;
    private boolean legacyChanged;
    private boolean previousSpeaker;

    public SpeakerAudioRoute(AudioManager manager) {
        this.manager = manager;
    }

    /** Device policy is independent of Android services so it can be regression tested. */
    public static int preferredDeviceType(int[] available) {
        int[] priority = {AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE,
                AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_HEARING_AID,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_SPEAKER,
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER};
        for (int type : priority) {
            for (int candidate : available) {
                if (candidate == type) return type;
            }
        }
        return 0;
    }

    public synchronized void start() {
        previousSpeaker = manager.isSpeakerphoneOn();
        if (Build.VERSION.SDK_INT >= 23) {
            callback = new AudioDeviceCallback() {
                @Override public void onAudioDevicesAdded(AudioDeviceInfo[] devices) { update(); }
                @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] devices) { update(); }
            };
            manager.registerAudioDeviceCallback(callback, new Handler(Looper.getMainLooper()));
        }
        update();
    }

    private synchronized void update() {
        if (closed) return;
        if (Build.VERSION.SDK_INT >= 31) {
            java.util.List<AudioDeviceInfo> devices = manager.getAvailableCommunicationDevices();
            int[] types = new int[devices.size()];
            for (int i = 0; i < devices.size(); i++) types[i] = devices.get(i).getType();
            int preferred = preferredDeviceType(types);
            for (AudioDeviceInfo device : devices) {
                if (device.getType() != preferred) continue;
                AudioDeviceInfo current = manager.getCommunicationDevice();
                if (current != null && current.getId() == device.getId()) return;
                boolean accepted = manager.setCommunicationDevice(device);
                if (accepted) selected = true;
                Log.i(TAG, "routeType=" + preferred + " accepted=" + accepted);
                return;
            }
            Log.w(TAG, "No speaker or external communication device available");
        } else {
            boolean external = manager.isWiredHeadsetOn() || manager.isBluetoothScoOn()
                    || manager.isBluetoothA2dpOn();
            if (Build.VERSION.SDK_INT >= 23) {
                for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                    int type = device.getType();
                    if (type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_USB_DEVICE
                            || type == AudioDeviceInfo.TYPE_WIRED_HEADSET
                            || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES) external = true;
                }
            }
            boolean speaker = !external;
            if (manager.isSpeakerphoneOn() != speaker) {
                manager.setSpeakerphoneOn(speaker);
                legacyChanged = true;
            }
        }
    }

    public synchronized void close() {
        if (closed) return;
        closed = true;
        if (Build.VERSION.SDK_INT >= 23 && callback != null) {
            manager.unregisterAudioDeviceCallback(callback);
        }
        if (Build.VERSION.SDK_INT >= 31 && selected) {
            manager.clearCommunicationDevice();
        } else if (Build.VERSION.SDK_INT < 31 && legacyChanged) {
            manager.setSpeakerphoneOn(previousSpeaker);
        }
    }
}
