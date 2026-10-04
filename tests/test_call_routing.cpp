#include "VCProximity.h"
#include <cassert>
int main() {
    VCProximity::setEnabled(true);
    VCProximity::clearPlayers(); VCProximity::clearCalls();
    VCProximity::updatePlayer("Alice", "Overworld", 0, 64, 0, 4, true, 3);
    VCProximity::updatePlayer("Bob", "Overworld", 1000, 64, 0, 4, true, 3);
    VCProximity::updatePlayer("C", "Overworld", 1, 64, 0, 30, false, 3);
    VCProximity::updatePlayer("D", "Overworld", 1001, 64, 0, 30, false, 3);
    VCProximity::updatePlayer("Outside", "Overworld", 5, 64, 0, 30, false, 3);
    VCProximity::updateCall("test", "Alice", "Bob", false, false);
    assert(VCProximity::attenuationFactor("Alice", "C") > 0);
    assert(VCProximity::attenuationFactor("Bob", "C") == 0);
    assert(VCProximity::attenuationFactor("Bob", "D") > 0);
    assert(VCProximity::attenuationFactor("Alice", "D") == 0);
    assert(VCProximity::attenuationFactor("Alice", "Outside") == 0);
    VCProximity::updateCall("test", "Alice", "Bob", true, false);
    assert(VCProximity::attenuationFactor("Alice", "C") > 0);
    assert(VCProximity::attenuationFactor("Bob", "C") > 0);
    assert(VCProximity::attenuationFactor("Alice", "D") == 0);
    assert(VCProximity::attenuationFactor("Bob", "Outside") == 0);
    VCProximity::updateCall("test", "Alice", "Bob", true, true);
    assert(VCProximity::attenuationFactor("Alice", "D") > 0);
    assert(VCProximity::attenuationFactor("Alice", "Bob") == 1);
    assert(VCProximity::attenuationFactor("Bob", "Alice") == 1);
    VCProximity::removeCall("test");
    assert(VCProximity::attenuationFactor("Bob", "C") == 0);
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
