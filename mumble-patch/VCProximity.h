#pragma once

#include <QtCore/QString>
#include <QtCore/QtGlobal>

namespace VCProximity {

void setEnabled(bool enabled);
bool isEnabled();
void setStaleTimeoutMs(qint64 timeoutMs);
void updatePlayer(const QString &mumbleName,
                  const QString &dimension,
                  double x,
                  double y,
                  double z,
                  float rangeBlocks,
                  bool voiceEnabled,
                  int attenuationLevel);
void removePlayer(const QString &mumbleName);
void clearPlayers();
void touchPlayers();
int playerCount();

// Returns a per-listener volume factor in the range [0, 1]. When proximity is
// disabled, stock Mumble routing is preserved with factor 1.0.
float attenuationFactor(const QString &speakerName, const QString &listenerName);

// Returns true when Mumble should retain the receiver in the normal-speech
// routing path.
bool shouldRoute(const QString &speakerName, const QString &listenerName);

} // namespace VCProximity
