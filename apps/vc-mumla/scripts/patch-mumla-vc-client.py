#!/usr/bin/env python3
"""Patch pinned Mumla/Humla source for VC per-listener gain support."""

from __future__ import annotations

import argparse
import pathlib
import sys


MUMALA_PIN = "477b337ebcee1655c1357d51db99cf92bbc175a4"
HUMLA_PIN = "7966f3828d6ed87ef29c517abfade6ad7998cdc5"
GAIN_MAGIC = "VCG1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected exactly one {label}; found {count}")
    return text.replace(old, new, 1)


def patch_audio_output(path: pathlib.Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "VC_GAIN_TRAILER" in text:
        return

    text = replace_once(
        text,
        "    private ExecutorService mDecodeExecutorService;\n",
        "    private ExecutorService mDecodeExecutorService;\n"
        "    private long mVcLastGainLogMs = 0L; // VC_GAIN_DIAGNOSTIC\n",
        "AudioOutput diagnostic field",
    )

    old = """            PacketBuffer dataBuffer = new PacketBuffer(pds.bufferBlock(pds.left()));
            aop.addFrameToBuffer(dataBuffer, msgFlags, seq);
"""
    new = """            byte[] vcVoicePayload = pds.dataBlock(pds.left());
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
"""
    text = replace_once(text, old, new, "AudioOutput queue handoff")
    path.write_text(text, encoding="utf-8")


def patch_audio_output_speech(path: pathlib.Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "VC_SERVER_GAIN_PCM" in text:
        return

    text = replace_once(
        text,
        "    private int mMissCount = 0;\n",
        "    private int mMissCount = 0;\n"
        "    private float mServerVolumeFactor = 1.0f; // VC_SERVER_GAIN_PCM\n",
        "server volume field",
    )

    text = replace_once(
        text,
        "    public void addFrameToBuffer(PacketBuffer pb, byte flags, int seq) {\n",
        "    public void addFrameToBuffer(PacketBuffer pb, byte flags, int seq, float serverVolumeFactor) {\n",
        "addFrameToBuffer signature",
    )

    old_packet = """                Speex.JitterBufferPacket packet = new Speex.JitterBufferPacket(data, size, AudioHandler.FRAME_SIZE * seq, samples, 0, flags);
"""
    new_packet = """                int vcGainByte = Math.max(0, Math.min(255, Math.round(serverVolumeFactor * 255.0f)));
                int vcUserData = (vcGainByte << 8) | (flags & 0xff);
                Speex.JitterBufferPacket packet = new Speex.JitterBufferPacket(
                        data, size, AudioHandler.FRAME_SIZE * seq, samples, 0, vcUserData);
"""
    text = replace_once(text, old_packet, new_packet, "jitter packet gain metadata")

    old_flags = """                        ucFlags = jbp.getUserData();
"""
    new_flags = """                        int vcUserData = jbp.getUserData();
                        ucFlags = vcUserData & 0xff;
                        mServerVolumeFactor = ((vcUserData >>> 8) & 0xff) / 255.0f;
"""
    text = replace_once(text, old_flags, new_flags, "jitter gain restore")

    old_copy = """            System.arraycopy(mOut, 0, mBuffer, mBufferFilled, decodedSamples);
"""
    new_copy = """            if (mServerVolumeFactor < 0.999f) {
                for (int i = 0; i < decodedSamples; i++) {
                    mOut[i] *= mServerVolumeFactor;
                }
            }
            System.arraycopy(mOut, 0, mBuffer, mBufferFilled, decodedSamples);
"""
    if old_copy not in text:
        raise RuntimeError("could not locate final PCM mixer copy")
    before, marker, after = text.rpartition(old_copy)
    text = before + new_copy + after

    path.write_text(text, encoding="utf-8")



def patch_aec_settings(settings_path: pathlib.Path, audio_xml_path: pathlib.Path) -> None:
    text = settings_path.read_text(encoding="utf-8")
    if "VC_AEC_DEFAULT_SYSTEM" not in text:
        text = replace_once(
            text,
            "import android.content.SharedPreferences;\nimport android.view.Gravity;\n",
            "import android.content.SharedPreferences;\n"
            "import android.media.audiofx.AcousticEchoCanceler;\n"
            "import android.view.Gravity;\n",
            "Settings AEC import",
        )
        text = replace_once(
            text,
            '    public static final String DEFAULT_ECHO_CANCELLATION_METHOD = "none";\n',
            '    public static final String DEFAULT_ECHO_CANCELLATION_METHOD = "system"; // VC_AEC_DEFAULT_SYSTEM\n'
            '    private static final String PREF_VC_AEC_MIGRATED = "vc_aec_migrated_v1";\n',
            "Settings AEC default",
        )
        text = replace_once(
            text,
            """    private Settings(Context ctx) {
        preferences = PreferenceManager.getDefaultSharedPreferences(ctx);
    }
""",
            """    private Settings(Context ctx) {
        preferences = PreferenceManager.getDefaultSharedPreferences(ctx);
        if (!preferences.getBoolean(PREF_VC_AEC_MIGRATED, false)) {
            SharedPreferences.Editor editor = preferences.edit()
                    .putBoolean(PREF_VC_AEC_MIGRATED, true);
            if (AcousticEchoCanceler.isAvailable()) {
                editor.putString(PREF_ECHO_CANCELLATION_METHOD, "system");
            }
            editor.apply();
        }
    }
""",
            "Settings one-time AEC migration",
        )
        text = replace_once(
            text,
            """    public String getEchoCancellationMethod() {
        return preferences.getString(PREF_ECHO_CANCELLATION_METHOD, DEFAULT_ECHO_CANCELLATION_METHOD);
    }
""",
            """    public String getEchoCancellationMethod() {
        String method = preferences.getString(
                PREF_ECHO_CANCELLATION_METHOD,
                DEFAULT_ECHO_CANCELLATION_METHOD
        );
        if ("system".equals(method) && !AcousticEchoCanceler.isAvailable()) {
            return "none";
        }
        return method;
    }
""",
            "Settings AEC fallback",
        )
        settings_path.write_text(text, encoding="utf-8")

    xml = audio_xml_path.read_text(encoding="utf-8")
    if 'android:key="echo_cancellation_method"' not in xml:
        raise RuntimeError("could not locate echo cancellation preference")
    old = """        <ListPreference
            android:defaultValue="none"
            android:entries="@array/echoCancellationNames"
"""
    new = """        <ListPreference
            android:defaultValue="system"
            android:entries="@array/echoCancellationNames"
"""
    if old in xml:
        xml = xml.replace(old, new, 1)
    elif new not in xml:
        raise RuntimeError("could not update echo cancellation preference default")
    audio_xml_path.write_text(xml, encoding="utf-8")


def patch_audio_input_aec(path: pathlib.Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "VC_AEC_DIAGNOSTIC" in text:
        return

    text = replace_once(
        text,
        "import android.media.audiofx.AcousticEchoCanceler;\n",
        "import android.media.audiofx.AcousticEchoCanceler;\n"
        "import android.media.audiofx.AudioEffect;\n",
        "AudioInput AudioEffect import",
    )

    old = """    private boolean enableEchoCancellation() {
        if (mEchoCancellationMethod.equals("system") /* android.media.audiofx.AcousticEchoCanceler */) {
            if (!AcousticEchoCanceler.isAvailable()) {
                Log.e(TAG, "could not enable system AEC: not available");
                return false;
            }
            if (aec != null) {
                aec.release();
            }
            aec = AcousticEchoCanceler.create(mAudioRecord.getAudioSessionId());
            if (aec == null) {
                Log.e(TAG, "could not enable system AEC: create failed");
                return false;
            }
            aec.setEnabled(true);
            return true;
        } else if (mEchoCancellationMethod.equals("none")) {
            Log.w(TAG, "echocancellation not enabled by user");
        } else {
            Log.w(TAG, "ignoring unknown echocancellation method: " + mEchoCancellationMethod);
        }
        return false;
    }
"""
    new = """    private boolean enableEchoCancellation() {
        if (mEchoCancellationMethod.equals("system") /* android.media.audiofx.AcousticEchoCanceler */) {
            boolean available = AcousticEchoCanceler.isAvailable();
            if (!available) {
                Log.e(TAG, "VC-AEC available=false method=system"); // VC_AEC_DIAGNOSTIC
                return false;
            }
            if (aec != null) {
                aec.release();
            }
            int sessionId = mAudioRecord.getAudioSessionId();
            aec = AcousticEchoCanceler.create(sessionId);
            if (aec == null) {
                Log.e(TAG, "VC-AEC available=true create=false session=" + sessionId);
                return false;
            }
            int status = aec.setEnabled(true);
            boolean enabled = aec.getEnabled();
            boolean hasControl = aec.hasControl();
            Log.i(TAG, "VC-AEC available=true create=true enabled=" + enabled
                    + " control=" + hasControl
                    + " status=" + status
                    + " session=" + sessionId
                    + " source=" + mAudioRecord.getAudioSource());
            if (status != AudioEffect.SUCCESS || !enabled) {
                aec.release();
                aec = null;
                return false;
            }
            return true;
        } else if (mEchoCancellationMethod.equals("none")) {
            Log.w(TAG, "VC-AEC method=none");
        } else {
            Log.w(TAG, "VC-AEC ignoring unknown method=" + mEchoCancellationMethod);
        }
        return false;
    }
"""
    text = replace_once(text, old, new, "AudioInput AEC implementation")
    path.write_text(text, encoding="utf-8")


def patch_audio_handler_aec(path: pathlib.Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "VC_AEC_AUDIO_MODE" in text:
        return

    text = replace_once(
        text,
        "    private final AudioManager mAudioManager;\n",
        "    private final AudioManager mAudioManager;\n"
        "    private int mVcPreviousAudioMode = AudioManager.MODE_NORMAL; // VC_AEC_AUDIO_MODE\n"
        "    private boolean mVcCommunicationModeActive = false;\n",
        "AudioHandler AEC mode fields",
    )

    old_ctor = """        mContext = context;
        mLogger = logger;
        mAudioStream = audioStream;
        mSampleRate = sampleRate;
        mBitrate = targetBitrate;
        mFramesPerPacket = targetFramesPerPacket;
        mInputMode = inputMode;
        mAmplitudeBoost = amplitudeBoost;
        mBluetoothOn = bluetoothEnabled;
        mHalfDuplex = halfDuplexEnabled;
        mPreprocessorEnabled = preprocessorEnabled;
        mEchoCancellationMethod = echoCancellationMethod;
        mEncodeListener = encodeListener;
        mOutputListener = outputListener;
        mTalking = false;
        mTargetId = targetId;

        mAudioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        mEncoderLock = new Object();

        int actualSource = audioSource;
        if (echoCancellationMethod.equals("system") /* android.media.audiofx.AcousticEchoCanceler */) {
            // Enforce MODE_IN_COMMUNICATION for AudioManager, some AECs won't function without this.
            AudioManager audioManager = (AudioManager) mContext.getSystemService(Context.AUDIO_SERVICE);
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            actualSource = MediaRecorder.AudioSource.VOICE_COMMUNICATION;
        }
        mAudioSource = actualSource;
"""
    new_ctor = """        mContext = context;
        mLogger = logger;
        mSampleRate = sampleRate;
        mBitrate = targetBitrate;
        mFramesPerPacket = targetFramesPerPacket;
        mInputMode = inputMode;
        mAmplitudeBoost = amplitudeBoost;
        mBluetoothOn = bluetoothEnabled;
        mHalfDuplex = halfDuplexEnabled;
        mPreprocessorEnabled = preprocessorEnabled;
        mEchoCancellationMethod = echoCancellationMethod;
        mEncodeListener = encodeListener;
        mOutputListener = outputListener;
        mTalking = false;
        mTargetId = targetId;

        mAudioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        mEncoderLock = new Object();

        int actualSource = audioSource;
        int actualStream = audioStream;
        if (echoCancellationMethod.equals("system") /* android.media.audiofx.AcousticEchoCanceler */) {
            // Android's system AEC expects a communication capture context.
            mVcPreviousAudioMode = mAudioManager.getMode();
            mAudioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            mVcCommunicationModeActive = true;
            actualSource = MediaRecorder.AudioSource.VOICE_COMMUNICATION;
            Log.i(TAG, "VC-AEC audioMode=MODE_IN_COMMUNICATION"
                    + " previousMode=" + mVcPreviousAudioMode
                    + " inputSource=VOICE_COMMUNICATION"
                    + " outputStream=" + audioStream);
        }
        mAudioSource = actualSource;
        mAudioStream = actualStream;
"""
    text = replace_once(text, old_ctor, new_ctor, "AudioHandler communication audio mode")

    text = replace_once(
        text,
        """        mInput = new AudioInput(this, mAudioSource, mSampleRate, mEchoCancellationMethod);
        mOutput = new AudioOutput(mOutputListener);
""",
        """        try {
            mInput = new AudioInput(this, mAudioSource, mSampleRate, mEchoCancellationMethod);
        } catch (AudioInitializationException | NativeAudioException error) {
            restoreVcAudioMode();
            throw error;
        }
        mOutput = new AudioOutput(mOutputListener);
""",
        "AudioHandler input init rollback",
    )

    text = replace_once(
        text,
        """    /**
     * Shuts down the audio handler, halting input and output.
""",
        """    private void restoreVcAudioMode() {
        if (!mVcCommunicationModeActive) {
            return;
        }
        int currentMode = mAudioManager.getMode();
        if (currentMode == AudioManager.MODE_IN_COMMUNICATION) {
            mAudioManager.setMode(mVcPreviousAudioMode);
        }
        Log.i(TAG, "VC-AEC restoreAudioMode current=" + currentMode
                + " restored=" + mVcPreviousAudioMode);
        mVcCommunicationModeActive = false;
    }

    /**
     * Shuts down the audio handler, halting input and output.
""",
        "AudioHandler AEC restore helper",
    )

    old_shutdown = """        mInitialized = false;
        mBluetoothOn = false;

        mEncodeListener.onTalkingStateChanged(false);
"""
    new_shutdown = """        mInitialized = false;
        mBluetoothOn = false;

        restoreVcAudioMode();

        mEncodeListener.onTalkingStateChanged(false);
"""
    text = replace_once(text, old_shutdown, new_shutdown, "AudioHandler AEC mode restore")
    path.write_text(text, encoding="utf-8")



def patch_battery_unrestricted(
    manifest_path: pathlib.Path,
    activity_path: pathlib.Path,
    general_fragment_path: pathlib.Path,
    general_xml_path: pathlib.Path,
    strings_path: pathlib.Path,
) -> None:
    manifest = manifest_path.read_text(encoding="utf-8")
    permission = '    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />\n'
    if "VC_BATTERY_UNRESTRICTED_PERMISSION" not in manifest:
        marker = '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n'
        manifest = replace_once(
            manifest,
            marker,
            marker + permission.replace("/>", '/> <!-- VC_BATTERY_UNRESTRICTED_PERMISSION -->'),
            "VC Mumla battery permission",
        )
        manifest_path.write_text(manifest, encoding="utf-8")

    activity = activity_path.read_text(encoding="utf-8")
    if "VC_BATTERY_UNRESTRICTED_PROMPT" not in activity:
        activity = replace_once(
            activity,
            "import android.os.IBinder;\n",
            "import android.os.IBinder;\n"
            "import android.os.PowerManager;\n",
            "MumlaActivity battery imports",
        )
        activity = replace_once(
            activity,
            "    private static final int PERMISSIONS_REQUEST_POST_NOTIFICATIONS = 2;\n",
            "    private static final int PERMISSIONS_REQUEST_POST_NOTIFICATIONS = 2;\n"
            '    private static final String PREF_VC_BATTERY_PROMPTED = "vc_battery_prompted_v1"; // VC_BATTERY_UNRESTRICTED_PROMPT\n',
            "MumlaActivity battery preference",
        )
        activity = replace_once(
            activity,
            """            if (mSettings.isFirstRun()) {
                showFirstRunGuide();
            } else {
                new StartupAction().execute(this);
            }
""",
            """            if (mSettings.isFirstRun()) {
                showFirstRunGuide();
            } else {
                new StartupAction().execute(this);
                maybeShowVcBatteryPrompt();
            }
""",
            "MumlaActivity startup battery prompt",
        )
        activity = replace_once(
            activity,
            """        if (mSettings.isUsingCertificate()) {
            mSettings.setFirstRun(false);
            return;
        }
""",
            """        if (mSettings.isUsingCertificate()) {
            mSettings.setFirstRun(false);
            maybeShowVcBatteryPrompt();
            return;
        }
""",
            "MumlaActivity certificate battery prompt",
        )
        activity = replace_once(
            activity,
            """                    generateTask.execute();
                    mSettings.setFirstRun(false);
                })
                .show();
    }

    /**
     * Loads a fragment from the drawer.
""",
            """                    generateTask.execute();
                    mSettings.setFirstRun(false);
                    getWindow().getDecorView().post(this::maybeShowVcBatteryPrompt);
                })
                .show();
    }

    private boolean isVcBatteryUnrestricted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        return powerManager != null
                && powerManager.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void maybeShowVcBatteryPrompt() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || isVcBatteryUnrestricted()) {
            return;
        }
        SharedPreferences preferences =
                PreferenceManager.getDefaultSharedPreferences(this);
        if (preferences.getBoolean(PREF_VC_BATTERY_PROMPTED, false)) {
            return;
        }
        preferences.edit().putBoolean(PREF_VC_BATTERY_PROMPTED, true).apply();

        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.vc_battery_unrestricted_title)
                .setMessage(R.string.vc_battery_unrestricted_message)
                .setPositiveButton(
                        R.string.vc_battery_unrestricted_allow,
                        (dialog, which) -> requestVcBatteryUnrestricted()
                )
                .setNeutralButton(
                        R.string.vc_battery_unrestricted_settings,
                        (dialog, which) -> openVcBatteryOptimizationSettings()
                )
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }

    private void requestVcBatteryUnrestricted() {
        try {
            Intent request = new Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName())
            );
            startActivity(request);
        } catch (Exception error) {
            openVcBatteryOptimizationSettings();
        }
    }

    private void openVcBatteryOptimizationSettings() {
        try {
            startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        } catch (Exception error) {
            startActivity(new Intent(
                    android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName())
            ));
        }
    }

    /**
     * Loads a fragment from the drawer.
""",
            "MumlaActivity battery methods",
        )
        activity_path.write_text(activity, encoding="utf-8")

    fragment = general_fragment_path.read_text(encoding="utf-8")
    if "VC_BATTERY_UNRESTRICTED_SETTINGS" not in fragment:
        fragment = replace_once(
            fragment,
            "import android.os.Bundle;\n",
            "import android.content.Intent;\n"
            "import android.net.Uri;\n"
            "import android.os.Build;\n"
            "import android.os.Bundle;\n"
            "import android.os.PowerManager;\n",
            "GeneralSettingsFragment battery imports",
        )
        fragment = replace_once(
            fragment,
            '    private static final String USE_TOR_KEY = "useTor";\n',
            '    private static final String USE_TOR_KEY = "useTor";\n'
            '    private static final String VC_BATTERY_KEY = "vc_battery_unrestricted"; // VC_BATTERY_UNRESTRICTED_SETTINGS\n',
            "GeneralSettingsFragment battery key",
        )
        fragment = replace_once(
            fragment,
            """        Preference useOrbotPreference = getPreferenceScreen().findPreference(USE_TOR_KEY);
        requireNonNull(useOrbotPreference).setEnabled(OrbotHelper.isOrbotInstalled(requireContext()));
    }
}
""",
            """        Preference useOrbotPreference = getPreferenceScreen().findPreference(USE_TOR_KEY);
        requireNonNull(useOrbotPreference).setEnabled(OrbotHelper.isOrbotInstalled(requireContext()));

        Preference batteryPreference = getPreferenceScreen().findPreference(VC_BATTERY_KEY);
        requireNonNull(batteryPreference).setOnPreferenceClickListener(preference -> {
            requestVcBatteryUnrestricted();
            return true;
        });
        updateVcBatteryPreference();
    }

    @Override
    public void onResume() {
        super.onResume();
        updateVcBatteryPreference();
    }

    private boolean isVcBatteryUnrestricted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        PowerManager powerManager =
                (PowerManager) requireContext().getSystemService(android.content.Context.POWER_SERVICE);
        return powerManager != null
                && powerManager.isIgnoringBatteryOptimizations(requireContext().getPackageName());
    }

    private void updateVcBatteryPreference() {
        Preference preference = getPreferenceScreen().findPreference(VC_BATTERY_KEY);
        if (preference == null) {
            return;
        }
        preference.setSummary(
                isVcBatteryUnrestricted()
                        ? R.string.vc_battery_unrestricted_enabled
                        : R.string.vc_battery_unrestricted_disabled
        );
    }

    private void requestVcBatteryUnrestricted() {
        if (isVcBatteryUnrestricted()) {
            updateVcBatteryPreference();
            return;
        }
        try {
            Intent request = new Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + requireContext().getPackageName())
            );
            startActivity(request);
        } catch (Exception error) {
            try {
                startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Exception ignored) {
                startActivity(new Intent(
                        android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + requireContext().getPackageName())
                ));
            }
        }
    }
}
""",
            "GeneralSettingsFragment battery controls",
        )
        general_fragment_path.write_text(fragment, encoding="utf-8")

    general_xml = general_xml_path.read_text(encoding="utf-8")
    if 'android:key="vc_battery_unrestricted"' not in general_xml:
        general_xml = replace_once(
            general_xml,
            "</PreferenceScreen>\n",
            """    <Preference
        android:key="vc_battery_unrestricted"
        android:title="@string/vc_battery_unrestricted_title"
        android:summary="@string/vc_battery_unrestricted_disabled"
        app:iconSpaceReserved="false" />

</PreferenceScreen>
""",
            "General settings battery preference",
        )
        general_xml_path.write_text(general_xml, encoding="utf-8")

    strings = strings_path.read_text(encoding="utf-8")
    if 'name="vc_battery_unrestricted_title"' not in strings:
        strings = replace_once(
            strings,
            "</resources>\n",
            """    <string name="vc_battery_unrestricted_title">อนุญาตให้ทำงานเบื้องหลัง</string>
    <string name="vc_battery_unrestricted_message">อนุญาตให้ VC Mumla ไม่ถูกจำกัดโดยระบบประหยัดแบตเตอรี่ของ Android เพื่อให้ระบบเสียงยังทำงานต่อได้เมื่อปิดหน้าจอหรือเปิดแอปอื่น</string>
    <string name="vc_battery_unrestricted_allow">อนุญาต</string>
    <string name="vc_battery_unrestricted_settings">การตั้งค่าแบตเตอรี่</string>
    <string name="vc_battery_unrestricted_enabled">อนุญาตแล้ว — ระบบเสียงสามารถทำงานเบื้องหลังได้</string>
    <string name="vc_battery_unrestricted_disabled">ยังถูกจำกัด — แตะเพื่ออนุญาตให้ทำงานเบื้องหลัง</string>
</resources>
""",
            "VC Mumla battery strings",
        )
        strings_path.write_text(strings, encoding="utf-8")



def patch_quick_join(
    server_edit_path: pathlib.Path,
    dialog_layout_path: pathlib.Path,
    strings_path: pathlib.Path,
    model_handler_path: pathlib.Path,
    service_path: pathlib.Path,
    activity_path: pathlib.Path,
) -> None:
    server_edit = server_edit_path.read_text(encoding="utf-8")
    if "VC_QUICK_JOIN_DIALOG" not in server_edit:
        server_edit = replace_once(
            server_edit,
            "import android.os.Bundle;\n",
            "import android.os.Bundle;\n"
            "import android.graphics.drawable.GradientDrawable;\n",
            "Quick Join drawable import",
        )
        server_edit = replace_once(
            server_edit,
            "    private EditText mPasswordEdit;\n",
            "    private EditText mPasswordEdit;\n"
            "    private EditText mQuickJoinEdit; // VC_QUICK_JOIN_DIALOG\n",
            "Quick Join field",
        )
        server_edit = replace_once(
            server_edit,
            """        TextView titleLabel = view.findViewById(R.id.server_edit_name_title);
        mNameEdit = view.findViewById(R.id.server_edit_name);
        mHostEdit = view.findViewById(R.id.server_edit_host);
        mPortEdit = view.findViewById(R.id.server_edit_port);
        mUsernameEdit = view.findViewById(R.id.server_edit_username);
        mUsernameEdit.setHint(settings.getDefaultUsername());
        mPasswordEdit = view.findViewById(R.id.server_edit_password);
""",
            """        TextView titleLabel = view.findViewById(R.id.server_edit_name_title);
        mNameEdit = view.findViewById(R.id.server_edit_name);
        TextView quickJoinTitle = view.findViewById(R.id.server_edit_quick_join_title);
        mQuickJoinEdit = view.findViewById(R.id.server_edit_quick_join);
        View hostPortLabels = view.findViewById(R.id.server_edit_host_port_labels);
        View hostPortFields = view.findViewById(R.id.server_edit_host_port_fields);
        View usernameBox = view.findViewById(R.id.server_edit_username_box);
        TextView usernameTitle = view.findViewById(R.id.server_edit_username_title);
        TextView usernameWarning = view.findViewById(R.id.server_edit_username_warning);
        View passwordBox = view.findViewById(R.id.server_edit_password_box);
        mHostEdit = view.findViewById(R.id.server_edit_host);
        mPortEdit = view.findViewById(R.id.server_edit_port);
        mUsernameEdit = view.findViewById(R.id.server_edit_username);
        mUsernameEdit.setHint(settings.getDefaultUsername());
        mPasswordEdit = view.findViewById(R.id.server_edit_password);
""",
            "Quick Join view binding",
        )
        server_edit = replace_once(
            server_edit,
            """        if (shouldIgnoreTitle()) {
            titleLabel.setVisibility(View.GONE);
            mNameEdit.setVisibility(View.GONE);
        }
""",
            """        if (shouldIgnoreTitle()) {
            titleLabel.setVisibility(View.GONE);
            mNameEdit.setVisibility(View.GONE);

            quickJoinTitle.setVisibility(View.VISIBLE);
            mQuickJoinEdit.setVisibility(View.VISIBLE);
            hostPortLabels.setVisibility(View.GONE);
            hostPortFields.setVisibility(View.GONE);
            passwordBox.setVisibility(View.GONE); // VC_QUICK_JOIN_HIDE_PASSWORD
            mPasswordEdit.setText("");

            usernameTitle.setText(R.string.vc_xbox_username_title);
            usernameWarning.setText(R.string.vc_xbox_username_warning);
            usernameWarning.setVisibility(View.VISIBLE);
            mUsernameEdit.setHint(R.string.vc_xbox_username_hint);

            float density = getResources().getDisplayMetrics().density;
            GradientDrawable warningBackground = new GradientDrawable();
            warningBackground.setColor(0x18FF0000);
            warningBackground.setStroke(Math.max(2, Math.round(2f * density)), 0xFFE53935);
            warningBackground.setCornerRadius(12f * density);
            usernameBox.setBackground(warningBackground);
            int warningPadding = Math.round(12f * density);
            usernameBox.setPadding(warningPadding, warningPadding, warningPadding, warningPadding);

            if (oldServer != null) {
                int quickPort = oldServer.getPort() == 0 ? 64738 : oldServer.getPort();
                mQuickJoinEdit.setText(oldServer.getHost() + ":" + quickPort);
            }
        }
""",
            "Quick Join mode UI",
        )
        server_edit = replace_once(
            server_edit,
            """    public boolean validate() {
        if (mHostEdit.getText().length() == 0) {
""",
            """    public boolean validate() {
        if (shouldIgnoreTitle()) {
            if (!parseQuickJoinAddress()) {
                return false;
            }
            if (mUsernameEdit.getText().toString().trim().isEmpty()) {
                mUsernameEdit.setError(getString(R.string.vc_xbox_username_required));
                mUsernameEdit.requestFocus();
                return false;
            }
        }

        if (mHostEdit.getText().length() == 0) {
""",
            "Quick Join validation",
        )
        server_edit = replace_once(
            server_edit,
            """    private Server getServer() {
""",
            """    private boolean parseQuickJoinAddress() {
        String value = mQuickJoinEdit.getText().toString().trim();
        if (value.startsWith("mumble://")) {
            value = value.substring("mumble://".length());
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1).trim();
        }

        int separator = value.lastIndexOf(':');
        if (separator <= 0 || separator >= value.length() - 1) {
            mQuickJoinEdit.setError(getString(R.string.vc_quick_join_invalid));
            mQuickJoinEdit.requestFocus();
            return false;
        }

        String host = value.substring(0, separator).trim();
        String portText = value.substring(separator + 1).trim();
        if (host.startsWith("[") && host.endsWith("]") && host.length() > 2) {
            host = host.substring(1, host.length() - 1);
        }

        int port;
        try {
            port = Integer.parseInt(portText);
        } catch (NumberFormatException error) {
            mQuickJoinEdit.setError(getString(R.string.vc_quick_join_invalid));
            mQuickJoinEdit.requestFocus();
            return false;
        }

        if (host.isEmpty() || port < 1 || port > 65535) {
            mQuickJoinEdit.setError(getString(R.string.vc_quick_join_invalid));
            mQuickJoinEdit.requestFocus();
            return false;
        }

        mHostEdit.setText(host);
        mPortEdit.setText(String.valueOf(port));
        return true;
    }

    private Server getServer() {
""",
            "Quick Join address parser",
        )
        server_edit_path.write_text(server_edit, encoding="utf-8")

    layout = dialog_layout_path.read_text(encoding="utf-8")
    if 'android:id="@+id/server_edit_quick_join"' not in layout:
        layout = replace_once(
            layout,
            """    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content">
        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:text="@string/server_host" />
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="@string/server_port" />
    </LinearLayout>

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content">
""",
            """    <TextView
        android:id="@+id/server_edit_quick_join_title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/vc_quick_join_title"
        android:textStyle="bold"
        android:visibility="gone" />

    <EditText
        android:id="@+id/server_edit_quick_join"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:hint="@string/vc_quick_join_hint"
        android:inputType="textUri"
        android:singleLine="true"
        android:visibility="gone" />

    <LinearLayout
        android:id="@+id/server_edit_host_port_labels"
        android:layout_width="match_parent"
        android:layout_height="wrap_content">
        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:text="@string/server_host" />
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="@string/server_port" />
    </LinearLayout>

    <LinearLayout
        android:id="@+id/server_edit_host_port_fields"
        android:layout_width="match_parent"
        android:layout_height="wrap_content">
""",
            "Quick Join host/port layout",
        )
        layout = replace_once(
            layout,
            """    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/server_username" />

    <EditText
        android:layout_height="wrap_content"
        android:layout_width="match_parent"
        android:id="@+id/server_edit_username"
        android:inputType="text" />
""",
            """    <LinearLayout
        android:id="@+id/server_edit_username_box"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical">

        <TextView
            android:id="@+id/server_edit_username_title"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="@string/server_username" />

        <TextView
            android:id="@+id/server_edit_username_warning"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:paddingBottom="4dp"
            android:text="@string/vc_xbox_username_warning"
            android:textColor="#E53935"
            android:textStyle="bold"
            android:visibility="gone" />

        <EditText
            android:id="@+id/server_edit_username"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:inputType="text"
            android:singleLine="true" />
    </LinearLayout>
""",
            "Quick Join Xbox username box",
        )
        if 'android:id="@+id/server_edit_password_box"' not in layout:
            layout = replace_once(
                layout,
                """    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/server_password" />

    <EditText
        android:layout_height="wrap_content"
        android:layout_width="match_parent"
        android:id="@+id/server_edit_password"
        android:inputType="textPassword" />
""",
                """    <LinearLayout
        android:id="@+id/server_edit_password_box"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="@string/server_password" />

        <EditText
            android:id="@+id/server_edit_password"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:inputType="textPassword" />
    </LinearLayout>
""",
                "Quick Join password container",
            )

        dialog_layout_path.write_text(layout, encoding="utf-8")

    strings = strings_path.read_text(encoding="utf-8")
    if 'name="vc_quick_join_title"' not in strings:
        strings = strings.replace(
            '<string name="quickConnect">Quick Connect</string>',
            '<string name="quickConnect">Quick Join</string>',
            1,
        )
        strings = replace_once(
            strings,
            "</resources>\n",
            """    <string name="vc_quick_join_title">Quick Join — IP:Port</string>
    <string name="vc_quick_join_hint">เช่น 4dqruj3i.free.pwrp.cc:10027</string>
    <string name="vc_quick_join_invalid">กรุณาใส่ที่อยู่ในรูปแบบ IP:Port เช่น 4dqruj3i.free.pwrp.cc:10027</string>
    <string name="vc_xbox_username_title">ชื่อผู้ใช้ Xbox (จำเป็น)</string>
    <string name="vc_xbox_username_hint">ใส่ชื่อ Xbox ของคุณให้ตรงกับใน Minecraft</string>
    <string name="vc_xbox_username_warning">สำคัญ: ต้องใส่ชื่อ Xbox ให้ถูกต้องและตรงกับชื่อที่ใช้ใน Minecraft มิฉะนั้น Proximity Voice จะจับคู่ผู้เล่นไม่ได้</string>
    <string name="vc_xbox_username_required">จำเป็นต้องใส่ชื่อ Xbox ให้ตรงกับชื่อใน Minecraft</string>
    <string name="vc_server_password_title">เซิร์ฟเวอร์นี้มีรหัสผ่าน</string>
    <string name="vc_server_password_message">กรุณาใส่รหัสผ่านของ VC Mumble Server เพื่อเชื่อมต่อ หากกรอกรหัสแล้วแต่ยังเข้าไม่ได้ แสดงว่ารหัสผ่านไม่ถูกต้อง</string>
    <string name="vc_server_password_hint">รหัสผ่านเซิร์ฟเวอร์</string>
    <string name="vc_server_password_connect">เชื่อมต่อ</string>
</resources>
""",
            "Quick Join strings",
        )
        strings_path.write_text(strings, encoding="utf-8")

    model = model_handler_path.read_text(encoding="utf-8")
    if "VC_QUICK_JOIN_SERVER_NAME" not in model:
        model = replace_once(
            model,
            "    private int mSession;\n",
            "    private int mSession;\n"
            "    private String mVcWelcomeText; // VC_QUICK_JOIN_SERVER_NAME\n",
            "Quick Join welcome field",
        )
        model = replace_once(
            model,
            """    public ServerSettings getServerSettings() {
        return mServerSettings;
    }
""",
            """    public ServerSettings getServerSettings() {
        return mServerSettings;
    }

    public String getVcWelcomeText() {
        return mVcWelcomeText;
    }
""",
            "Quick Join welcome getter",
        )
        model = replace_once(
            model,
            """    public void clear() {
        mChannels.clear();
        mUsers.clear();
    }
""",
            """    public void clear() {
        mChannels.clear();
        mUsers.clear();
        mVcWelcomeText = null;
    }
""",
            "Quick Join welcome clear",
        )
        model = replace_once(
            model,
            """    public void messageServerSync(Mumble.ServerSync msg) {
        mSession = msg.getSession();
        mLogger.logInfo(msg.getWelcomeText());
    }
""",
            """    public void messageServerSync(Mumble.ServerSync msg) {
        mSession = msg.getSession();
        mVcWelcomeText = msg.getWelcomeText();
        mLogger.logInfo(msg.getWelcomeText());
    }
""",
            "Quick Join welcome capture",
        )
        model_handler_path.write_text(model, encoding="utf-8")

    service = service_path.read_text(encoding="utf-8")
    if "VC_QUICK_JOIN_AUTO_SERVER_NAME" not in service:
        service = replace_once(
            service,
            "import android.os.PowerManager;\n",
            "import android.os.PowerManager;\n"
            "import android.text.Html;\n",
            "Quick Join Html import",
        )
        service = replace_once(
            service,
            """        mCallbacks.onConnected();
    }

    @Override
    public void onConnectionHandshakeFailed(X509Certificate[] chain) {
""",
            """        applyVcServerNameFromWelcome(mModelHandler.getVcWelcomeText());
        mCallbacks.onConnected();
    }

    private void applyVcServerNameFromWelcome(String welcome) {
        if (mServer == null
                || welcome == null
                || !welcome.contains("Hosted by VC Mumble Server")) {
            return;
        }

        CharSequence formatted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            formatted = Html.fromHtml(welcome, Html.FROM_HTML_MODE_LEGACY);
        } else {
            formatted = Html.fromHtml(welcome);
        }

        String plain = formatted.toString().replace('\u00a0', ' ').trim();
        int marker = plain.indexOf("Hosted by VC Mumble Server");
        if (marker < 0) {
            return;
        }

        String serverName = plain.substring(0, marker).trim();
        if (!serverName.isEmpty()) {
            mServer.setName(serverName); // VC_QUICK_JOIN_AUTO_SERVER_NAME
            Log.i(TAG, "VC-QUICK-JOIN serverName=" + serverName);
        }
    }

    @Override
    public void onConnectionHandshakeFailed(X509Certificate[] chain) {
""",
            "Quick Join automatic server name",
        )
        service_path.write_text(service, encoding="utf-8")

    activity = activity_path.read_text(encoding="utf-8")
    if "VC_QUICK_JOIN_SAVE_SERVER" not in activity:
        activity = replace_once(
            activity,
            """        @Override
        public void onConnected() {
            if (mSettings.shouldStartUpInPinnedMode()) {
""",
            """        @Override
        public void onConnected() {
            Server connectedServer = mService != null ? mService.getTargetServer() : null;
            if (connectedServer != null) {
                if (connectedServer.isSaved()) {
                    mDatabase.updateServer(connectedServer);
                } else {
                    mDatabase.addServer(connectedServer); // VC_QUICK_JOIN_SAVE_SERVER
                }
            }

            if (mSettings.shouldStartUpInPinnedMode()) {
""",
            "Quick Join save connected server",
        )
        activity_path.write_text(activity, encoding="utf-8")

    activity = activity_path.read_text(encoding="utf-8")
    if "VC_QUICK_JOIN_PASSWORD_CHALLENGE" not in activity:
        activity = replace_once(
            activity,
            "passwordField.setHint(R.string.password);",
            "passwordField.setHint(R.string.vc_server_password_hint);",
            "Quick Join password hint",
        )
        activity = replace_once(
            activity,
            "builder.setTitle(R.string.invalid_password);",
            "builder.setTitle(R.string.vc_server_password_title); // VC_QUICK_JOIN_PASSWORD_CHALLENGE",
            "Quick Join password title",
        )
        activity = replace_once(
            activity,
            "builder.setMessage(error.getMessage());",
            "builder.setMessage(R.string.vc_server_password_message);",
            "Quick Join password message",
        )
        activity = replace_once(
            activity,
            "builder.setPositiveButton(R.string.reconnect, (dialog, which) -> {",
            "builder.setPositiveButton(R.string.vc_server_password_connect, (dialog, which) -> {",
            "Quick Join password reconnect button",
        )
        activity_path.write_text(activity, encoding="utf-8")

def patch_stable_transport(service_path: pathlib.Path) -> None:
    """Use the v0.2 transport behavior: force TCP on the active connection only."""
    service = service_path.read_text(encoding="utf-8")
    if "VC_FORCE_TCP_STABLE_TRANSPORT" not in service:
        service = replace_once(
            service,
            "            mConnection.setForceTCP(mForceTcp);\n",
            "            mConnection.setForceTCP(true); // VC_FORCE_TCP_STABLE_TRANSPORT\n",
            "Humla force-TCP configuration",
        )

    if "VC_CLIENT_RELEASE_ID" not in service:
        service = replace_once(
            service,
            "        version.setRelease(mClientName);\n",
            '        version.setRelease("VC Mumla v0.5 AEC"); // VC_CLIENT_RELEASE_ID\n',
            "Mumble release string",
        )
    service_path.write_text(service, encoding="utf-8")

def patch_app_identity(root: pathlib.Path) -> None:
    beta_strings = root / "app/src/beta/res/values/strings_notranslate.xml"
    text = beta_strings.read_text(encoding="utf-8")
    text = text.replace(
        '<string name="app_name">Mumla Beta</string>',
        '<string name="app_name">VC Mumla</string>',
    )
    beta_strings.write_text(text, encoding="utf-8")


def validate(root: pathlib.Path) -> None:
    audio_output = (root / "libraries/humla/src/main/java/se/lublin/humla/audio/AudioOutput.java").read_text(encoding="utf-8")
    speech = (root / "libraries/humla/src/main/java/se/lublin/humla/audio/AudioOutputSpeech.java").read_text(encoding="utf-8")
    service = (root / "libraries/humla/src/main/java/se/lublin/humla/HumlaService.java").read_text(encoding="utf-8")
    beta_strings = (root / "app/src/beta/res/values/strings_notranslate.xml").read_text(encoding="utf-8")
    settings = (root / "app/src/main/java/se/lublin/mumla/Settings.java").read_text(encoding="utf-8")
    settings_audio = (root / "app/src/main/res/xml/settings_audio.xml").read_text(encoding="utf-8")
    audio_input = (root / "libraries/humla/src/main/java/se/lublin/humla/audio/AudioInput.java").read_text(encoding="utf-8")
    audio_handler = (root / "libraries/humla/src/main/java/se/lublin/humla/protocol/AudioHandler.java").read_text(encoding="utf-8")
    manifest = (root / "app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
    mumla_activity = (root / "app/src/main/java/se/lublin/mumla/app/MumlaActivity.java").read_text(encoding="utf-8")
    general_fragment = (root / "app/src/main/java/se/lublin/mumla/preference/GeneralSettingsFragment.java").read_text(encoding="utf-8")
    general_xml = (root / "app/src/main/res/xml/settings_general.xml").read_text(encoding="utf-8")
    strings = (root / "app/src/main/res/values/strings.xml").read_text(encoding="utf-8")
    server_edit = (root / "app/src/main/java/se/lublin/mumla/servers/ServerEditFragment.java").read_text(encoding="utf-8")
    server_edit_layout = (root / "app/src/main/res/layout/dialog_server_edit.xml").read_text(encoding="utf-8")
    model_handler = (root / "libraries/humla/src/main/java/se/lublin/humla/protocol/ModelHandler.java").read_text(encoding="utf-8")

    checks = {
        "gain trailer parser": "VC_GAIN_TRAILER" in audio_output,
        "gain diagnostic": "VC_GAIN_DIAGNOSTIC" in audio_output and "VC-GAIN rx" in audio_output,
        "gain handoff": "addFrameToBuffer(dataBuffer, msgFlags, seq, vcServerGain)" in audio_output,
        "PCM gain": "VC_SERVER_GAIN_PCM" in speech,
        "per-packet gain": "vcGainByte" in speech and "vcUserData" in speech,
        "PCM multiply": "mOut[i] *= mServerVolumeFactor" in speech,
        "stable TCP tunnel": "VC_FORCE_TCP_STABLE_TRANSPORT" in service and "setForceTCP(true)" in service,
        "client release id": "VC Mumla v0.5 AEC" in service,
        "AEC default": "VC_AEC_DEFAULT_SYSTEM" in settings and 'DEFAULT_ECHO_CANCELLATION_METHOD = "system"' in settings,
        "AEC migration": "PREF_VC_AEC_MIGRATED" in settings,
        "AEC XML default": 'android:defaultValue="system"' in settings_audio,
        "AEC diagnostics": "VC_AEC_DIAGNOSTIC" in audio_input and "AudioEffect.SUCCESS" in audio_input,
        "communication mode": "VC_AEC_AUDIO_MODE" in audio_handler and "MODE_IN_COMMUNICATION" in audio_handler,
        "communication source": "VOICE_COMMUNICATION" in audio_handler,
        "audio mode restore": "restoreAudioMode" in audio_handler,
        "custom app label": "VC Mumla" in beta_strings,
        "battery permission": "VC_BATTERY_UNRESTRICTED_PERMISSION" in manifest and "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" in manifest,
        "battery startup prompt": "VC_BATTERY_UNRESTRICTED_PROMPT" in mumla_activity and "android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" in mumla_activity,
        "battery settings control": "VC_BATTERY_UNRESTRICTED_SETTINGS" in general_fragment and "android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS" in general_fragment,
        "battery settings preference": 'android:key="vc_battery_unrestricted"' in general_xml,
        "battery strings": 'name="vc_battery_unrestricted_title"' in strings,
        "Quick Join dialog": "VC_QUICK_JOIN_DIALOG" in server_edit and "parseQuickJoinAddress" in server_edit,
        "Quick Join layout": 'android:id="@+id/server_edit_quick_join"' in server_edit_layout and 'android:id="@+id/server_edit_username_box"' in server_edit_layout,
        "Quick Join Xbox required": "vc_xbox_username_required" in server_edit and "vc_xbox_username_warning" in strings,
        "Quick Join password hidden": "VC_QUICK_JOIN_HIDE_PASSWORD" in server_edit and 'android:id="@+id/server_edit_password_box"' in server_edit_layout,
        "Quick Join password challenge": "VC_QUICK_JOIN_PASSWORD_CHALLENGE" in mumla_activity and "vc_server_password_title" in strings,
        "Quick Join saved server": "VC_QUICK_JOIN_SAVE_SERVER" in mumla_activity and "mDatabase.addServer(connectedServer)" in mumla_activity,
        "Quick Join welcome capture": "VC_QUICK_JOIN_SERVER_NAME" in model_handler and "getVcWelcomeText" in model_handler,
        "Quick Join server name": "VC_QUICK_JOIN_AUTO_SERVER_NAME" in service and "Hosted by VC Mumble Server" in service,
    }
    missing = [name for name, ok in checks.items() if not ok]
    if missing:
        raise RuntimeError("VC Mumla validation failed: " + ", ".join(missing))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=pathlib.Path)
    args = parser.parse_args()
    root = args.root.resolve()

    try:
        patch_battery_unrestricted(
            root / "app/src/main/AndroidManifest.xml",
            root / "app/src/main/java/se/lublin/mumla/app/MumlaActivity.java",
            root / "app/src/main/java/se/lublin/mumla/preference/GeneralSettingsFragment.java",
            root / "app/src/main/res/xml/settings_general.xml",
            root / "app/src/main/res/values/strings.xml",
        )
        patch_quick_join(
            root / "app/src/main/java/se/lublin/mumla/servers/ServerEditFragment.java",
            root / "app/src/main/res/layout/dialog_server_edit.xml",
            root / "app/src/main/res/values/strings.xml",
            root / "libraries/humla/src/main/java/se/lublin/humla/protocol/ModelHandler.java",
            root / "libraries/humla/src/main/java/se/lublin/humla/HumlaService.java",
            root / "app/src/main/java/se/lublin/mumla/app/MumlaActivity.java",
        )
        patch_aec_settings(
            root / "app/src/main/java/se/lublin/mumla/Settings.java",
            root / "app/src/main/res/xml/settings_audio.xml",
        )
        patch_audio_input_aec(root / "libraries/humla/src/main/java/se/lublin/humla/audio/AudioInput.java")
        patch_audio_handler_aec(root / "libraries/humla/src/main/java/se/lublin/humla/protocol/AudioHandler.java")
        patch_audio_output(root / "libraries/humla/src/main/java/se/lublin/humla/audio/AudioOutput.java")
        patch_audio_output_speech(root / "libraries/humla/src/main/java/se/lublin/humla/audio/AudioOutputSpeech.java")
        patch_stable_transport(root / "libraries/humla/src/main/java/se/lublin/humla/HumlaService.java")
        patch_app_identity(root)
        validate(root)
    except RuntimeError as exc:
        print(f"patch-mumla-vc-client: {exc}", file=sys.stderr)
        return 1

    print("VC Mumla patch: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
