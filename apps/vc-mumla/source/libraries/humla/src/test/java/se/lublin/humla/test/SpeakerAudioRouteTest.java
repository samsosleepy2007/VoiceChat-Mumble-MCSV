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
}
