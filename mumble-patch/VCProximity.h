#pragma once

#include <QtCore/QString>
#include <QtCore/QtGlobal>

namespace VCProximity {

void setEnabled(bool enabled);
bool isEnabled();
// Gate the sender before *any* audio context, including whispers and calls.
// Missing, stale, disabled or explicitly muted player state is never allowed.
bool canSpeak(const QString &speakerName);
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

void updateCall(const QString &callId,
                const QString &partyA,
                const QString &partyB,
                bool speakerA,
                bool speakerB);
void removeCall(const QString &callId);
void clearCalls();
int callCount();

// Returns a per-listener volume factor in the range [0, 1]. When proximity is
// disabled, routing fails closed with factor 0.0.
float attenuationFactor(const QString &speakerName, const QString &listenerName);

// Returns true when Mumble should retain the receiver in the normal-speech
// routing path.
bool shouldRoute(const QString &speakerName, const QString &listenerName);

} // namespace VCProximity
