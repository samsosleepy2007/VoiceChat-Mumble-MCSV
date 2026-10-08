package se.lublin.humla.test;

import android.media.AudioDeviceInfo;
import junit.framework.TestCase;
import se.lublin.humla.audio.SpeakerAudioRoute;

public class SpeakerAudioRouteTest extends TestCase {
    public void testPhoneDefaultsToLoudspeaker() {
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, SpeakerAudioRoute.preferredDeviceType(
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER}));
    }
    public void testTabletWithoutEarpiece() {
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, SpeakerAudioRoute.preferredDeviceType(
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_SPEAKER}));
    }
    public void testWiredHeadsetTakesPriority() {
        assertEquals(AudioDeviceInfo.TYPE_WIRED_HEADSET, SpeakerAudioRoute.preferredDeviceType(
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_WIRED_HEADSET}));
    }
    public void testUsbHeadsetTakesPriority() {
        assertEquals(AudioDeviceInfo.TYPE_USB_HEADSET, SpeakerAudioRoute.preferredDeviceType(
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_USB_HEADSET}));
    }
    public void testBluetoothHeadsetTakesPriority() {
        assertEquals(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, SpeakerAudioRoute.preferredDeviceType(
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BLUETOOTH_SCO}));
        assertEquals(AudioDeviceInfo.TYPE_BLE_HEADSET, SpeakerAudioRoute.preferredDeviceType(
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BLE_HEADSET}));
    }
    public void testUnplugReturnsToSpeaker() {
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, SpeakerAudioRoute.preferredDeviceType(
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER}));
    }
    public void testDoesNotChooseQuietEarpieceAsFallback() {
        assertEquals(0, SpeakerAudioRoute.preferredDeviceType(new int[]{AudioDeviceInfo.TYPE_BUILTIN_EARPIECE}));
    }
    public void testExplicitSpeakerOverridesConnectedHeadset() {
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, SpeakerAudioRoute.chooseDeviceType("2",
                new int[]{AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER}));
    }
    public void testDisconnectedChoiceFallsBackAndReturnsWhenReconnected() {
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, SpeakerAudioRoute.chooseDeviceType("22",
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_SPEAKER}));
        assertEquals(AudioDeviceInfo.TYPE_USB_HEADSET, SpeakerAudioRoute.chooseDeviceType("22",
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_USB_HEADSET}));
    }
    public void testExplicitEarpieceOnlyWhenRequested() {
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, SpeakerAudioRoute.chooseDeviceType("1",
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE}));
    }
    public void testLegacyUsesLoudspeakerWithoutHeadset() {
        assertTrue(SpeakerAudioRoute.legacySpeakerphone("auto", AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, false));
        assertTrue(SpeakerAudioRoute.legacySpeakerphone("auto", 0, false));
    }
    public void testLegacyLeavesHeadsetAndEarpieceAlone() {
        assertFalse(SpeakerAudioRoute.legacySpeakerphone("auto", AudioDeviceInfo.TYPE_WIRED_HEADSET, true));
        assertFalse(SpeakerAudioRoute.legacySpeakerphone("auto", 0, true));
        assertFalse(SpeakerAudioRoute.legacySpeakerphone("1", AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, false));
    }
    public void testInvalidPreferenceUsesSafeDefault() {
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, SpeakerAudioRoute.chooseDeviceType("invalid",
                new int[]{AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER}));
    }
}
