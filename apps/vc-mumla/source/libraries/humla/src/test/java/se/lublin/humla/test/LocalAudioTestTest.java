package se.lublin.humla.test;

import junit.framework.TestCase;
import se.lublin.humla.audio.LocalAudioTest;
import java.util.Arrays;

public class LocalAudioTestTest extends TestCase {
    public void testRunsExactlyThreeSecondsAndStops() {
        LocalAudioTest tone = new LocalAudioTest(48000);
        short[] buffer = new short[480];
        assertFalse(tone.mix(buffer, 0, buffer.length));
        tone.start();
        for (int i = 0; i < 300; i++) assertTrue(tone.mix(buffer, 0, buffer.length));
        assertFalse(tone.isPlaying());
        assertFalse(tone.mix(buffer, 0, buffer.length));
    }
    public void testStopAndRestart() {
        LocalAudioTest tone = new LocalAudioTest(48000);
        short[] first = new short[480], restarted = new short[480];
        tone.start(); tone.mix(first, 0, first.length);
        tone.stop(); assertFalse(tone.isPlaying());
        tone.start(); tone.mix(restarted, 0, restarted.length);
        assertTrue(Arrays.equals(first, restarted));
        int peak = 0;
        for (short value : first) peak = Math.max(peak, Math.abs((int) value));
        assertTrue(peak > 1000 && peak <= 3932);
    }
    public void testMixClipsInsteadOfWrappingAndHonorsOffset() {
        LocalAudioTest tone = new LocalAudioTest(48000);
        short[] buffer = new short[482];
        Arrays.fill(buffer, (short) 32760);
        tone.start(); tone.mix(buffer, 1, 480);
        assertEquals(32760, buffer[0]); assertEquals(32760, buffer[481]);
        boolean clipped = false;
        for (int i = 1; i < 481; i++) {
            assertTrue(buffer[i] >= 32760 - 3932);
            clipped |= buffer[i] == Short.MAX_VALUE;
        }
        assertTrue(clipped);
    }
    public void testFinalPartialBufferPreservesIncomingVoice() {
        LocalAudioTest tone = new LocalAudioTest(1000);
        short[] buffer = new short[3002];
        Arrays.fill(buffer, (short) 50);
        tone.start(); assertTrue(tone.mix(buffer, 0, buffer.length));
        assertEquals(50, buffer[3000]); assertEquals(50, buffer[3001]);
        assertFalse(tone.isPlaying());
    }
}
