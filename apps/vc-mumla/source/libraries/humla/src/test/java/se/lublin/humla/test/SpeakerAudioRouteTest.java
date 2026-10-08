package se.lublin.humla.test;

import android.media.AudioDeviceInfo;
import junit.framework.TestCase;
import se.lublin.humla.audio.SpeakerAudioRoute;

public class SpeakerAudioRouteTest extends TestCase {
    public void testVoiceUsesMediaPath() {
        assertEquals("media", SpeakerAudioRoute.MODE);
    }
    public void testStatusBeforeRouting() {
        assertEquals("mode=media actualType=unknown", SpeakerAudioRoute.statusLine(0));
    }
    public void testStatusReportsLoudspeaker() {
        assertEquals("mode=media actualType=" + AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
                SpeakerAudioRoute.statusLine(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER));
    }
}
