package se.lublin.mumla.preference;

import static java.util.Objects.requireNonNull;
import static se.lublin.mumla.Settings.DEFAULT_ECHO_CANCELLATION_METHOD;
import static se.lublin.mumla.Settings.PREF_ECHO_CANCELLATION_METHOD;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.media.AudioDeviceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.preference.Preference;
import se.lublin.humla.HumlaService;
import se.lublin.humla.IHumlaService;
import se.lublin.mumla.service.MumlaService;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.audiofx.AcousticEchoCanceler;
import android.os.Bundle;

import androidx.preference.ListPreference;
import androidx.preference.PreferenceCategory;
import androidx.preference.PreferenceScreen;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import se.lublin.mumla.R;
import se.lublin.mumla.Settings;

public class AudioSettingsFragment extends MumlaPreferenceFragment {
    @Override
    public void onCreatePreferences(Bundle savedInstanceState, String rootKey) {
        Settings.getInstance(requireContext());
        setPreferencesFromResource(R.xml.settings_audio, rootKey);
        actualPreference = findPreference("vc_audio_actual");
        testPreference = findPreference("vc_audio_test");
        testPreference.setOnPreferenceClickListener(preference -> {
            if (service != null) {
                if (service.isAudioTestPlaying()) service.stopAudioTest();
                else service.startAudioTest();
            }
            refreshAudio();
            return true;
        });
        refreshAudio();

        ListPreference inputPreference = getPreferenceScreen().findPreference(Settings.PREF_INPUT_METHOD);
        requireNonNull(inputPreference).setOnPreferenceChangeListener((preference, newValue) -> {
            updateAudioDependents(getPreferenceScreen(), (String) newValue);
            return true;
        });

        // Scan each bitrate and determine if the device supports it
        ListPreference inputQualityPreference = getPreferenceScreen().findPreference(Settings.PREF_INPUT_RATE);
        String[] bitrateNames = new String[requireNonNull(inputQualityPreference).getEntryValues().length];
        for (int x = 0; x < bitrateNames.length; x++) {
            int bitrate = Integer.parseInt(inputQualityPreference.getEntryValues()[x].toString());
            boolean supported = AudioRecord.getMinBufferSize(bitrate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT) > 0;
            bitrateNames[x] = bitrate + "Hz" + (supported ? "" : " (unsupported)");
        }
        inputQualityPreference.setEntries(bitrateNames);

        ListPreference echoCancellationPref = findPreference(PREF_ECHO_CANCELLATION_METHOD);
        if (echoCancellationPref != null) {
            if (!AcousticEchoCanceler.isAvailable()) {
                // android.media.audiofx.AcousticEchoCanceler is unavailable
                removeListEntry(echoCancellationPref, "system");
            }
            // Fallback to default ("none") if unset, or current value is no longer available
            String current = echoCancellationPref.getValue();
            if (current == null || !Arrays.asList(echoCancellationPref.getEntryValues()).contains(current)) {
                echoCancellationPref.setValue(DEFAULT_ECHO_CANCELLATION_METHOD);
            }
        }

        updateAudioDependents(getPreferenceScreen(), inputPreference.getValue());
    }

    private Preference actualPreference, testPreference;
    private IHumlaService service;
    private boolean bound;
    private final Handler audioUiHandler = new Handler(Looper.getMainLooper());
    private final Runnable audioRefresh = new Runnable() {
        @Override public void run() {
            refreshAudio();
            audioUiHandler.postDelayed(this, 500);
        }
    };
    private final ServiceConnection audioConnection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((MumlaService.MumlaBinder) binder).getService();
            refreshAudio();
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            service = null;
            refreshAudio();
        }
    };

    @Override public void onStart() {
        super.onStart();
        bound = requireContext().bindService(new Intent(requireContext(), MumlaService.class),
                audioConnection, Context.BIND_AUTO_CREATE);
        audioUiHandler.post(audioRefresh);
        requireActivity().setVolumeControlStream(Settings.getInstance(requireContext()).getVoiceAudioStream());
    }

    @Override public void onStop() {
        audioUiHandler.removeCallbacksAndMessages(null);
        if (service != null) service.stopAudioTest();
        if (bound) requireContext().unbindService(audioConnection);
        bound = false;
        service = null;
        super.onStop();
    }

    private String deviceName(AudioDeviceInfo device) {
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return getString(R.string.vc_audio_speaker);
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return getString(R.string.vc_audio_earpiece);
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_BLE_SPEAKER:
            case AudioDeviceInfo.TYPE_HEARING_AID: return "Bluetooth: " + device.getProductName();
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_USB_DEVICE: return getString(R.string.vc_audio_headphones) + ": " + device.getProductName();
            default: return device.getProductName().toString();
        }
    }

    private void refreshAudio() {
        if (!isAdded() || actualPreference == null) return;
        boolean connected = service != null && service.isConnected();
        if (connected) requireActivity().setVolumeControlStream(service.getAudioOutputStream());
        testPreference.setEnabled(connected);
        boolean playing = connected && service.isAudioTestPlaying();
        testPreference.setTitle(playing ? R.string.vc_audio_stop : R.string.vc_audio_test);
        testPreference.setSummary(connected ? R.string.vc_audio_test_summary : R.string.vc_audio_connect_first);
        AudioDeviceInfo actual = connected && Build.VERSION.SDK_INT >= 23 ? service.getRoutedAudioDevice() : null;
        actualPreference.setSummary(!connected ? getString(R.string.vc_audio_connect_first)
                : actual == null ? getString(R.string.vc_audio_unknown) : deviceName(actual));
        actualPreference.setSelectable(false);
    }

    private void removeListEntry(ListPreference pref, String valueToRemove) {
        List<CharSequence> entries = new ArrayList<>(Arrays.asList(pref.getEntries()));
        List<CharSequence> values = new ArrayList<>(Arrays.asList(pref.getEntryValues()));
        for (int i = 0; i < values.size(); i++) {
            if (values.get(i).toString().equals(valueToRemove)) {
                entries.remove(i);
                values.remove(i);
            }
        }
        pref.setEntries(entries.toArray(new CharSequence[0]));
        pref.setEntryValues(values.toArray(new CharSequence[0]));
    }

    private static void updateAudioDependents(PreferenceScreen screen, String inputMethod) {
        PreferenceCategory pttCategory = screen.findPreference("ptt_settings");
        PreferenceCategory vadCategory = screen.findPreference("vad_settings");
        requireNonNull(pttCategory).setEnabled(Settings.ARRAY_INPUT_METHOD_PTT.equals(inputMethod));
        requireNonNull(vadCategory).setEnabled(Settings.ARRAY_INPUT_METHOD_VOICE.equals(inputMethod));
    }
}
