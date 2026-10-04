import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "patch-mumla-vc-client.py"


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        root = pathlib.Path(raw)
        humla_root = root / "libraries/humla/src/main/java/se/lublin/humla"
        audio = humla_root / "audio"
        protocol = humla_root / "protocol"
        app_java = root / "app/src/main/java/se/lublin/mumla"
        app_app = app_java / "app"
        app_pref = app_java / "preference"
        app_servers = app_java / "servers"
        app_xml = root / "app/src/main/res/xml"
        app_layout = root / "app/src/main/res/layout"
        app_values = root / "app/src/main/res/values"
        beta = root / "app/src/beta/res/values"

        audio.mkdir(parents=True)
        protocol.mkdir(parents=True)
        app_java.mkdir(parents=True)
        app_app.mkdir(parents=True)
        app_pref.mkdir(parents=True)
        app_servers.mkdir(parents=True)
        app_xml.mkdir(parents=True)
        app_layout.mkdir(parents=True)
        app_values.mkdir(parents=True)
        beta.mkdir(parents=True)


        (root / "app/src/main/AndroidManifest.xml").parent.mkdir(parents=True, exist_ok=True)
        (root / "app/src/main/AndroidManifest.xml").write_text(
            """<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <application />
</manifest>
""",
            encoding="utf-8",
        )

        (app_app / "MumlaActivity.java").write_text(
            """import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;

class MumlaActivity {
    private Settings mSettings;
    private static final int PERMISSIONS_REQUEST_POST_NOTIFICATIONS = 2;

    private final HumlaObserver mObserver = new HumlaObserver() {
        @Override
        public void onConnected() {
            if (mSettings.shouldStartUpInPinnedMode()) {
                loadDrawerFragment(DrawerAdapter.ITEM_PINNED_CHANNELS);
            } else {
                loadDrawerFragment(DrawerAdapter.ITEM_SERVER);
            }

            mDrawerAdapter.notifyDataSetChanged();
            supportInvalidateOptionsMenu();

            updateConnectionState(getService());
        }
    };

    void onCreate(Bundle savedInstanceState) {
        if (savedInstanceState == null) {
            if (mSettings.isFirstRun()) {
                showFirstRunGuide();
            } else {
                new StartupAction().execute(this);
            }
        }
    }

    private void showFirstRunGuide() {
        if (mSettings.isUsingCertificate()) {
            mSettings.setFirstRun(false);
            return;
        }
        new MaterialAlertDialogBuilder(this)
                .setPositiveButton(R.string.generate, (DialogInterface dialog, int which) -> {
                    MumlaCertificateGenerateTask generateTask = new MumlaCertificateGenerateTask(MumlaActivity.this) {};
                    generateTask.execute();
                    mSettings.setFirstRun(false);
                })
                .show();
    }

    /**
     * Loads a fragment from the drawer.
     */
    private void loadDrawerFragment(int fragmentId) {
    }

    private void updateConnectionState() {
        HumlaException error = getService().getConnectionError();
        if (error != null &&
                error.getReason() == HumlaException.HumlaDisconnectReason.REJECT &&
                (error.getReject().getType() == Mumble.Reject.RejectType.WrongUserPW ||
                        error.getReject().getType() == Mumble.Reject.RejectType.WrongServerPW)) {
            final EditText passwordField = new EditText(this);
            passwordField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            passwordField.setHint(R.string.password);
            MaterialAlertDialogBuilder builder = new MaterialAlertDialogBuilder(this);
            builder.setTitle(R.string.invalid_password);
            builder.setMessage(error.getMessage());
            builder.setView(passwordField);
            builder.setPositiveButton(R.string.reconnect, (dialog, which) -> {
                Server server1 = getService().getTargetServer();
                if (server1 == null) {
                    return;
                }
                String password = passwordField.getText().toString();
                server1.setPassword(password);
                if (server1.isSaved()) {
                    mDatabase.updateServer(server1);
                }
                connectToServer(server1);
            });
        }
    }
}
""",
            encoding="utf-8",
        )

        (app_pref / "GeneralSettingsFragment.java").write_text(
            """package se.lublin.mumla.preference;

import static java.util.Objects.requireNonNull;

import android.os.Bundle;

import androidx.preference.Preference;

import info.guardianproject.netcipher.proxy.OrbotHelper;
import se.lublin.mumla.R;

public class GeneralSettingsFragment extends MumlaPreferenceFragment {
    private static final String USE_TOR_KEY = "useTor";

    @Override
    public void onCreatePreferences(Bundle savedInstanceState, String rootKey) {
        setPreferencesFromResource(R.xml.settings_general, rootKey);

        Preference useOrbotPreference = getPreferenceScreen().findPreference(USE_TOR_KEY);
        requireNonNull(useOrbotPreference).setEnabled(OrbotHelper.isOrbotInstalled(requireContext()));
    }
}
""",
            encoding="utf-8",
        )

        (app_xml / "settings_general.xml").write_text(
            """<PreferenceScreen xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto">
    <CheckBoxPreference
        android:key="stay_awake"
        android:title="@string/stay_awake"
        app:iconSpaceReserved="false" />
</PreferenceScreen>
""",
            encoding="utf-8",
        )

        (app_values / "strings.xml").write_text(
            """<resources>
    <string name="general">General</string>
    <string name="quickConnect">Quick Connect</string>
</resources>
""",
            encoding="utf-8",
        )

        (app_servers / "ServerEditFragment.java").write_text(
            """package se.lublin.mumla.servers;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;

class ServerEditFragment {
    private EditText mNameEdit;
    private EditText mHostEdit;
    private EditText mPortEdit;
    private EditText mUsernameEdit;
    private EditText mPasswordEdit;

    void onCreateDialog() {
        Settings settings = Settings.getInstance(getActivity());
        LayoutInflater inflater = LayoutInflater.from(getActivity());
        View view = inflater.inflate(R.layout.dialog_server_edit, null, false);

        TextView titleLabel = view.findViewById(R.id.server_edit_name_title);
        mNameEdit = view.findViewById(R.id.server_edit_name);
        mHostEdit = view.findViewById(R.id.server_edit_host);
        mPortEdit = view.findViewById(R.id.server_edit_port);
        mUsernameEdit = view.findViewById(R.id.server_edit_username);
        mUsernameEdit.setHint(settings.getDefaultUsername());
        mPasswordEdit = view.findViewById(R.id.server_edit_password);

        Server oldServer = getServer();
        if (oldServer != null) {
            mNameEdit.setText(oldServer.getName());
            mHostEdit.setText(oldServer.getHost());
            if (oldServer.getPort() != 0) {
                mPortEdit.setText(String.valueOf(oldServer.getPort()));
            }
            mUsernameEdit.setText(oldServer.getUsername());
            mPasswordEdit.setText(oldServer.getPassword());
        }

        if (shouldIgnoreTitle()) {
            titleLabel.setVisibility(View.GONE);
            mNameEdit.setVisibility(View.GONE);
        }
    }

    public boolean validate() {
        if (mHostEdit.getText().length() == 0) {
            mHostEdit.setError(getString(R.string.invalid_host));
            return false;
        } else if (mPortEdit.getText().length() > 0) {
            try {
                int port = Integer.parseInt(mPortEdit.getText().toString());
                if (port < 1 || port > 65535) {
                    mPortEdit.setError(getString(R.string.invalid_port_range));
                    return false;
                }
            } catch (NumberFormatException nfe) {
                mPortEdit.setError(getString(R.string.invalid_port_range));
                return false;
            }
        }
        return true;
    }

    private Server getServer() {
        return null;
    }

    private boolean shouldIgnoreTitle() {
        return true;
    }
}
""",
            encoding="utf-8",
        )

        (app_layout / "dialog_server_edit.xml").write_text(
            """<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical">

    <TextView
        android:id="@+id/server_edit_name_title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/server_label" />

    <EditText
        android:id="@+id/server_edit_name"
        android:layout_width="fill_parent"
        android:layout_height="wrap_content"
        android:inputType="text" />

    <LinearLayout
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
        <EditText
            android:id="@+id/server_edit_host"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:inputType="textUri" />
        <EditText
            android:id="@+id/server_edit_port"
            android:layout_width="wrap_content"
            android:maxEms="5"
            android:layout_height="wrap_content"
            android:hint="@string/default_"
            android:inputType="number"
            android:maxLength="5">
        </EditText>
    </LinearLayout>

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/server_username" />

    <EditText
        android:layout_height="wrap_content"
        android:layout_width="match_parent"
        android:id="@+id/server_edit_username"
        android:inputType="text" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/server_password" />

    <EditText
        android:layout_height="wrap_content"
        android:layout_width="match_parent"
        android:id="@+id/server_edit_password"
        android:inputType="textPassword" />
</LinearLayout>
""",
            encoding="utf-8",
        )

        (protocol / "ModelHandler.java").write_text(
            """class ModelHandler {
    private ServerSettings mServerSettings;
    private int mPermissions;
    private int mSession;

    public ServerSettings getServerSettings() {
        return mServerSettings;
    }

    public void clear() {
        mChannels.clear();
        mUsers.clear();
    }

    public void messageServerSync(Mumble.ServerSync msg) {
        mSession = msg.getSession();
        mLogger.logInfo(msg.getWelcomeText());
    }
}
""",
            encoding="utf-8",
        )

        (app_java / "Settings.java").write_text(
            """import android.content.Context;
import android.content.SharedPreferences;
import android.view.Gravity;

class Settings {
    public static final String PREF_ECHO_CANCELLATION_METHOD = "echo_cancellation_method";
    public static final String DEFAULT_ECHO_CANCELLATION_METHOD = "none";
    private final SharedPreferences preferences;

    private Settings(Context ctx) {
        preferences = PreferenceManager.getDefaultSharedPreferences(ctx);
    }

    public String getEchoCancellationMethod() {
        return preferences.getString(PREF_ECHO_CANCELLATION_METHOD, DEFAULT_ECHO_CANCELLATION_METHOD);
    }
}
""",
            encoding="utf-8",
        )

        (app_xml / "settings_audio.xml").write_text(
            """<PreferenceScreen>
        <ListPreference
            android:defaultValue="none"
            android:entries="@array/echoCancellationNames"
            android:entryValues="@array/echoCancellationValues"
            android:key="echo_cancellation_method"
            android:summary="@string/echoCancellationMethodSum"
            android:title="@string/echoCancellationMethod" />
</PreferenceScreen>
""",
            encoding="utf-8",
        )

        (audio / "AudioInput.java").write_text(
            """import android.media.audiofx.AcousticEchoCanceler;
import android.util.Log;

class AudioInput {
    private static final String TAG = "AudioInput";
    private String mEchoCancellationMethod;
    private AcousticEchoCanceler aec;
    private AudioRecord mAudioRecord;

    private boolean enableEchoCancellation() {
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
}
""",
            encoding="utf-8",
        )

        (protocol / "AudioHandler.java").write_text(
            """class AudioHandler {
    private static final String TAG = "AudioHandler";
    private final AudioManager mAudioManager;
    private final int mAudioStream;
    private final int mAudioSource;
    private int mSampleRate;
    private int mBitrate;
    private int mFramesPerPacket;
    private IInputMode mInputMode;
    private float mAmplitudeBoost;
    private boolean mBluetoothOn;
    private boolean mHalfDuplex;
    private boolean mPreprocessorEnabled;
    private String mEchoCancellationMethod;
    private AudioEncodeListener mEncodeListener;
    private AudioOutput.AudioOutputListener mOutputListener;
    private boolean mTalking;
    private byte mTargetId;
    private Object mEncoderLock;
    private Context mContext;
    private HumlaLogger mLogger;
    private boolean mInitialized;

    public AudioHandler(Context context, HumlaLogger logger, int audioStream, int audioSource,
                        int sampleRate, int targetBitrate, int targetFramesPerPacket,
                        IInputMode inputMode, byte targetId, float amplitudeBoost,
                        boolean bluetoothEnabled, boolean halfDuplexEnabled,
                        boolean preprocessorEnabled, String echoCancellationMethod,
                        AudioEncodeListener encodeListener,
                        AudioOutput.AudioOutputListener outputListener) throws AudioInitializationException, NativeAudioException {
        mContext = context;
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

        mInput = new AudioInput(this, mAudioSource, mSampleRate, mEchoCancellationMethod);
        mOutput = new AudioOutput(mOutputListener);
    }

    /**
     * Shuts down the audio handler, halting input and output.
     */
    public synchronized void shutdown() {
        mInitialized = false;
        mBluetoothOn = false;

        mEncodeListener.onTalkingStateChanged(false);
    }
}
""",
            encoding="utf-8",
        )

        (audio / "AudioOutput.java").write_text(
            """import java.util.Arrays;
class AudioOutput {
    private ExecutorService mDecodeExecutorService;
    void x() {
            PacketBuffer dataBuffer = new PacketBuffer(pds.bufferBlock(pds.left()));
            aop.addFrameToBuffer(dataBuffer, msgFlags, seq);
    }
}
""",
            encoding="utf-8",
        )

        (audio / "AudioOutputSpeech.java").write_text(
            """class AudioOutputSpeech {
    private int mMissCount = 0;
    public void addFrameToBuffer(PacketBuffer pb, byte flags, int seq) {
                Speex.JitterBufferPacket packet = new Speex.JitterBufferPacket(data, size, AudioHandler.FRAME_SIZE * seq, samples, 0, flags);
                        ucFlags = jbp.getUserData();
            System.arraycopy(mOut, 0, mBuffer, mBufferFilled, decodedSamples);
    }
}
""",
            encoding="utf-8",
        )

        (humla_root / "HumlaService.java").write_text(
            """import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

class HumlaService {
    private Server mServer;
    private ModelHandler mModelHandler;
    private HumlaCallbacks mCallbacks;

    void connect() {
            mConnection.setForceTCP(mForceTcp);
    }

    public void onConnectionSynchronized() {
        mCallbacks.onConnected();
    }

    @Override
    public void onConnectionHandshakeFailed(X509Certificate[] chain) {
    }

    void version() {
        version.setRelease(mClientName);
    }
}
""",
            encoding="utf-8",
        )

        (beta / "strings_notranslate.xml").write_text(
            '<resources><string name="app_name">Mumla Beta</string></resources>',
            encoding="utf-8",
        )

        for run in range(2):
            result = subprocess.run(
                ["python3", str(SCRIPT), "--root", str(root)],
                text=True,
                capture_output=True,
                check=False,
            )
            assert result.returncode == 0, f"run {run + 1}: {result.stderr}"

        manifest = (root / "app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
        mumla_activity = (app_app / "MumlaActivity.java").read_text(encoding="utf-8")
        general_fragment = (app_pref / "GeneralSettingsFragment.java").read_text(encoding="utf-8")
        general_xml = (app_xml / "settings_general.xml").read_text(encoding="utf-8")
        strings = (app_values / "strings.xml").read_text(encoding="utf-8")
        settings = (app_java / "Settings.java").read_text(encoding="utf-8")
        settings_audio = (app_xml / "settings_audio.xml").read_text(encoding="utf-8")
        audio_input = (audio / "AudioInput.java").read_text(encoding="utf-8")
        audio_handler = (protocol / "AudioHandler.java").read_text(encoding="utf-8")
        audio_output = (audio / "AudioOutput.java").read_text(encoding="utf-8")
        speech = (audio / "AudioOutputSpeech.java").read_text(encoding="utf-8")
        service = (humla_root / "HumlaService.java").read_text(encoding="utf-8")
        server_edit = (app_servers / "ServerEditFragment.java").read_text(encoding="utf-8")
        server_edit_layout = (app_layout / "dialog_server_edit.xml").read_text(encoding="utf-8")
        model_handler = (protocol / "ModelHandler.java").read_text(encoding="utf-8")

        assert "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" in manifest
        assert "VC_BATTERY_UNRESTRICTED_PERMISSION" in manifest
        assert "VC_BATTERY_UNRESTRICTED_PROMPT" in mumla_activity
        assert "ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" in mumla_activity
        assert "ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS" in mumla_activity
        assert "PREF_VC_BATTERY_PROMPTED" in mumla_activity
        assert "VC_BATTERY_UNRESTRICTED_SETTINGS" in general_fragment
        assert "isIgnoringBatteryOptimizations" in general_fragment
        assert 'android:key="vc_battery_unrestricted"' in general_xml
        assert 'name="vc_battery_unrestricted_title"' in strings
        assert "อนุญาตให้ทำงานเบื้องหลัง" in strings
        assert "อนุญาตให้ VC Mumla ไม่ถูกจำกัดโดยระบบประหยัดแบตเตอรี่ของ Android" in strings
        assert "การตั้งค่าแบตเตอรี่" in strings
        assert "VC_QUICK_JOIN_DIALOG" in server_edit
        assert "parseQuickJoinAddress" in server_edit
        assert "vc_xbox_username_required" in server_edit
        assert 'android:id="@+id/server_edit_quick_join"' in server_edit_layout
        assert 'android:id="@+id/server_edit_username_box"' in server_edit_layout
        assert "Quick Join" in strings
        assert "ชื่อผู้ใช้ Xbox (จำเป็น)" in strings
        assert "Proximity Voice จะจับคู่ผู้เล่นไม่ได้" in strings
        assert "VC_QUICK_JOIN_SERVER_NAME" in model_handler
        assert "getVcWelcomeText" in model_handler
        assert "VC_QUICK_JOIN_AUTO_SERVER_NAME" in service
        assert "Hosted by VC Mumble Server" in service
        assert "VC_QUICK_JOIN_HIDE_PASSWORD" in server_edit
        assert 'android:id="@+id/server_edit_password_box"' in server_edit_layout
        assert "VC_QUICK_JOIN_PASSWORD_CHALLENGE" in mumla_activity
        assert "vc_server_password_title" in strings
        assert "เซิร์ฟเวอร์นี้มีรหัสผ่าน" in strings
        assert "VC_QUICK_JOIN_SAVE_SERVER" in mumla_activity
        assert "mDatabase.addServer(connectedServer)" in mumla_activity
        assert "mDatabase.updateServer(connectedServer)" in mumla_activity

        assert 'DEFAULT_ECHO_CANCELLATION_METHOD = "system"' in settings
        assert "PREF_VC_AEC_MIGRATED" in settings
        assert "AcousticEchoCanceler.isAvailable()" in settings
        assert 'android:defaultValue="system"' in settings_audio

        assert "VC_AEC_DIAGNOSTIC" in audio_input
        assert "AudioEffect.SUCCESS" in audio_input
        assert "aec.getEnabled()" in audio_input
        assert "aec.hasControl()" in audio_input

        assert "VC_AEC_AUDIO_MODE" in audio_handler
        assert "AudioManager.MODE_IN_COMMUNICATION" in audio_handler
        assert "MediaRecorder.AudioSource.VOICE_COMMUNICATION" in audio_handler
        assert "restoreAudioMode" in audio_handler
        assert "mAudioManager.setMode(mVcPreviousAudioMode)" in audio_handler

        assert "VC_GAIN_TRAILER" in audio_output
        assert "VC_GAIN_DIAGNOSTIC" in audio_output
        assert "VC_SERVER_GAIN_PCM" in speech
        assert "VC_FORCE_TCP_STABLE_TRANSPORT" in service
        assert "VC Mumla v0.5 AEC" in service
        assert "VC Mumla" in (beta / "strings_notranslate.xml").read_text(encoding="utf-8")

    print("VC Mumla AEC patch fixture: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
