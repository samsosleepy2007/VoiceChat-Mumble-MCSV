package se.lublin.humla.audio;

import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Reports where voice playback is routed for one voice connection.
 *
 * Voice plays on the media path, so Android routes it like any media app: the main
 * loudspeaker, or a connected wired/USB/Bluetooth headset. This class deliberately never
 * changes the audio mode, communication device, speakerphone or a preferred device;
 * on some phones those communication controls open the earpiece and loudspeaker together.
 */
public final class SpeakerAudioRoute {
    public static final String PREF_OUTPUT = "vc_audio_output";
    public static final String MODE = "media";
    private static final String TAG = "SleepyMumlaAudioRoute";
    private final AudioManager manager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private AudioTrack.OnRoutingChangedListener trackListener;
    private AudioTrack track;
    private boolean closed;
    private volatile int routedType;
    private String status = "mode=" + MODE + " actualType=unknown";

    public SpeakerAudioRoute(AudioManager manager) { this.manager = manager; }

    /** Status line shown in Settings; {@code routedType} is 0 when not yet known. */
    public static String statusLine(int routedType) {
        return "mode=" + MODE + " actualType=" + (routedType == 0 ? "unknown" : Integer.toString(routedType));
    }

    public synchronized AudioDeviceInfo[] getDevices() {
        if (Build.VERSION.SDK_INT >= 23) return manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        return new AudioDeviceInfo[0];
    }

    public synchronized void start() { update(); }

    /** Output selection was removed with the earpiece path; kept so callers stay compatible. */
    public synchronized void setPolicy(String value) { }

    public synchronized void attach(AudioTrack output) {
        track = output;
        if (Build.VERSION.SDK_INT >= 23) {
            trackListener = audioTrack -> update();
            track.addOnRoutingChangedListener(trackListener, handler);
        }
        update();
    }

    public synchronized void onPlaybackStarted() { handler.postDelayed(this::update, 250); }

    public synchronized AudioDeviceInfo getRoutedDevice() {
        return !closed && track != null && Build.VERSION.SDK_INT >= 23 ? track.getRoutedDevice() : null;
    }

    public synchronized String getStatus() { return status; }

    /** True for the built-in speaker, or while the route is still unknown. */
    public boolean isPhoneSpeaker() {
        int type = routedType;
        return type == 0 || type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
    }

    private synchronized void update() {
        if (closed) return;
        AudioDeviceInfo actual = getRoutedDevice();
        routedType = actual == null ? 0 : actual.getType();
        status = statusLine(routedType);
        Log.i(TAG, status);
    }

    public synchronized void close() {
        if (closed) return;
        closed = true;
        handler.removeCallbacksAndMessages(null);
        if (Build.VERSION.SDK_INT >= 23 && track != null && trackListener != null)
            track.removeOnRoutingChangedListener(trackListener);
        track = null;
    }
}
