package se.lublin.humla.test;

import java.util.Arrays;
import junit.framework.TestCase;
import se.lublin.humla.audio.AudioOutput;

public class AudioOutputStereoTest extends TestCase {
    private static short[] stereo(String channel) {
        short[] out = new short[6];
        AudioOutput.toStereo(new short[]{100, -200, 300}, 3, channel, out);
        return out;
    }
    public void testBothDuplicatesMono() {
        assertTrue(Arrays.equals(new short[]{100, 100, -200, -200, 300, 300}, stereo(AudioOutput.CHANNEL_BOTH)));
    }
    public void testLeftSilencesRight() {
        assertTrue(Arrays.equals(new short[]{100, 0, -200, 0, 300, 0}, stereo(AudioOutput.CHANNEL_LEFT)));
    }
    public void testRightSilencesLeft() {
        assertTrue(Arrays.equals(new short[]{0, 100, 0, -200, 0, 300}, stereo(AudioOutput.CHANNEL_RIGHT)));
    }
    public void testUnknownValueKeepsBoth() {
        assertTrue(Arrays.equals(stereo(AudioOutput.CHANNEL_BOTH), stereo("unexpected")));
    }
}
