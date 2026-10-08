package se.lublin.humla.test;

import android.media.AudioDeviceInfo;
import junit.framework.TestCase;
import se.lublin.humla.audio.SpeakerAudioRoute;

public class SpeakerAudioRouteTest extends TestCase {
    private static final int SPEAKER = AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
    private static final int EARPIECE = AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;

    public void testCallModeUsesLoudspeakerNotEarpiece() {
        assertEquals(SPEAKER, SpeakerAudioRoute.chooseCallDeviceType(new int[]{EARPIECE, SPEAKER}));
    }
    public void testCallModeNeverPicksEarpiece() {
        assertEquals(0, SpeakerAudioRoute.chooseCallDeviceType(new int[]{EARPIECE}));
    }
    public void testCallModePrefersHeadsets() {
        assertEquals(AudioDeviceInfo.TYPE_WIRED_HEADSET, SpeakerAudioRoute.chooseCallDeviceType(
                new int[]{EARPIECE, SPEAKER, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_WIRED_HEADSET}));
        assertEquals(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, SpeakerAudioRoute.chooseCallDeviceType(
                new int[]{EARPIECE, SPEAKER, AudioDeviceInfo.TYPE_BLUETOOTH_SCO}));
    }
    public void testLegacySpeakerphoneOnlyWithoutHeadset() {
        assertTrue(SpeakerAudioRoute.legacySpeakerphone(false, false));
        assertFalse(SpeakerAudioRoute.legacySpeakerphone(true, false));
        assertFalse(SpeakerAudioRoute.legacySpeakerphone(false, true));
    }
    public void testStatusLines() {
        assertEquals("mode=call target=unknown actual=unknown",
                SpeakerAudioRoute.statusLine(SpeakerAudioRoute.MODE_CALL, 0, 0));
        assertEquals("mode=call target=" + SPEAKER + " actual=" + SPEAKER,
                SpeakerAudioRoute.statusLine(SpeakerAudioRoute.MODE_CALL, SPEAKER, SPEAKER));
        assertEquals("mode=media actual=" + SPEAKER,
                SpeakerAudioRoute.statusLine(SpeakerAudioRoute.MODE_MEDIA, SPEAKER, SPEAKER));
    }
}
