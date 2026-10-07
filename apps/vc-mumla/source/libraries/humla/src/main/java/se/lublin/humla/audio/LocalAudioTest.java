package se.lublin.humla.audio;

/** A bounded local PCM test mixed into the incoming voice track, never the encoder. */
public final class LocalAudioTest {
    private final int sampleRate;
    private int position, remaining;
    public LocalAudioTest(int sampleRate) { this.sampleRate = sampleRate; }
    public synchronized void start() { position = 0; remaining = sampleRate * 3; }
    public synchronized void stop() { remaining = 0; }
    public synchronized boolean isPlaying() { return remaining > 0; }
    public synchronized boolean mix(short[] buffer, int offset, int count) {
        if (remaining == 0) return false;
        int length = Math.min(count, remaining);
        for (int i = 0; i < length; i++, position++) {
            int beat = position % sampleRate;
            double envelope = Math.min(1.0, Math.min(beat / (sampleRate * .01),
                    (sampleRate * .7 - beat) / (sampleRate * .01)));
            envelope = Math.max(0, envelope);
            double frequency = position / sampleRate % 2 == 0 ? 660 : 880;
            int tone = (int) (Math.sin(2 * Math.PI * frequency * position / sampleRate) * 3932 * envelope);
            int value = buffer[offset + i] + tone;
            buffer[offset + i] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, value));
        }
        remaining -= length;
        return true;
    }
}
