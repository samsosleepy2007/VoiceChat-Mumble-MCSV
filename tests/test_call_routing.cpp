#include "VCProximity.h"
#include <cassert>
int main() {
    VCProximity::setEnabled(true);
    VCProximity::clearPlayers(); VCProximity::clearCalls();
    VCProximity::updatePlayer("Alice", "Overworld", 0, 64, 0, 30, false, 3);
    VCProximity::updatePlayer("Bob", "Nether", 100000, 64, 0, 30, false, 3);
    VCProximity::updatePlayer("Other", "Overworld", 100000, 64, 0, 30, false, 3);
    assert(VCProximity::attenuationFactor("Alice", "Bob") == 0);
    VCProximity::updateCall("test", "Alice", "Bob", false, false);
    assert(VCProximity::attenuationFactor("Alice", "Bob") == 1);
    assert(VCProximity::attenuationFactor("Bob", "Alice") == 1);
    assert(VCProximity::attenuationFactor("Alice", "Other") == 0);
    VCProximity::removeCall("test");
    assert(VCProximity::attenuationFactor("Alice", "Bob") == 0);
    VCProximity::clearPlayers(); VCProximity::clearCalls();
}
