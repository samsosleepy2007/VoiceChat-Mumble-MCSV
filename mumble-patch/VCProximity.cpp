#include "VCProximity.h"

#include <QtCore/QDateTime>
#include <QtCore/QDebug>
#include <QtCore/QHash>
#include <QtCore/QReadWriteLock>
#include <QtCore/QReadLocker>
#include <QtCore/QWriteLocker>

#include <algorithm>
#include <atomic>
#include <cmath>

namespace VCProximity {
// VC_DIAGNOSTIC_ROUTE_BUILD
namespace {
struct PlayerState {
    QString dimension;
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
    float rangeBlocks = 30.0F;
    bool voiceEnabled = true;
    int attenuationLevel = 2;
    qint64 updatedAtMs = 0;
};

QReadWriteLock g_lock;
QHash<QString, PlayerState> g_players;
std::atomic_bool g_enabled{ false };
std::atomic<qint64> g_staleTimeoutMs{ 45000 };
std::atomic<qint64> g_lastStateLogMs{ 0 };
std::atomic<qint64> g_lastRouteLogMs{ 0 };

bool shouldLog(std::atomic<qint64> &slot, qint64 nowMs, qint64 intervalMs) {
    qint64 previous = slot.load(std::memory_order_relaxed);
    if ((nowMs - previous) < intervalMs) return false;
    return slot.compare_exchange_strong(previous, nowMs, std::memory_order_relaxed);
}

QString keyFor(const QString &name) {
    return name.trimmed().toCaseFolded();
}

bool isFresh(const PlayerState &state, qint64 nowMs) {
    const qint64 timeout = g_staleTimeoutMs.load(std::memory_order_relaxed);
    return timeout <= 0 || (nowMs - state.updatedAtMs) <= timeout;
}

float smoothMix(float from, float to, double t) {
    const double clamped = std::clamp(t, 0.0, 1.0);
    const double smooth = clamped * clamped * (3.0 - 2.0 * clamped);
    return static_cast<float>(static_cast<double>(from)
                              + (static_cast<double>(to) - static_cast<double>(from)) * smooth);
}

float attenuationForNormalizedDistance(double normalizedDistance, int level) {
    const int clampedLevel = std::clamp(level, 0, 4);
    if (normalizedDistance >= 1.0) {
        return 0.0F;
    }
    if (clampedLevel == 0 || normalizedDistance <= 0.20) {
        return 1.0F;
    }

    float mid = 0.55F;
    float far = 0.15F;
    float edge = 0.03F;
    switch (clampedLevel) {
        case 1:
            mid = 0.80F;
            far = 0.45F;
            edge = 0.20F;
            break;
        case 3:
            mid = 0.40F;
            far = 0.08F;
            edge = 0.015F;
            break;
        case 4:
            mid = 0.25F;
            far = 0.03F;
            edge = 0.005F;
            break;
        default:
            break;
    }

    if (normalizedDistance <= 0.60) {
        return smoothMix(1.0F, mid, (normalizedDistance - 0.20) / 0.40);
    }
    if (normalizedDistance <= 0.90) {
        return smoothMix(mid, far, (normalizedDistance - 0.60) / 0.30);
    }
    return smoothMix(far, edge, (normalizedDistance - 0.90) / 0.10);
}
} // namespace

void setEnabled(bool enabled) {
    g_enabled.store(enabled, std::memory_order_release);
}

bool isEnabled() {
    return g_enabled.load(std::memory_order_acquire);
}

void setStaleTimeoutMs(qint64 timeoutMs) {
    g_staleTimeoutMs.store(std::max<qint64>(0, timeoutMs), std::memory_order_release);
}

void updatePlayer(const QString &mumbleName,
                  const QString &dimension,
                  double x,
                  double y,
                  double z,
                  float rangeBlocks,
                  bool voiceEnabled,
                  int attenuationLevel) {
    const QString key = keyFor(mumbleName);
    if (key.isEmpty()) return;

    PlayerState state;
    state.dimension = dimension.trimmed().toCaseFolded();
    state.x = x;
    state.y = y;
    state.z = z;
    state.rangeBlocks = std::max(0.0F, rangeBlocks);
    state.voiceEnabled = voiceEnabled;
    state.attenuationLevel = std::clamp(attenuationLevel, 0, 4);
    state.updatedAtMs = QDateTime::currentMSecsSinceEpoch();

    QWriteLocker locker(&g_lock);
    g_players.insert(key, state);
    locker.unlock();

    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (shouldLog(g_lastStateLogMs, now, 2000)) {
        qWarning().noquote()
            << "[VC-PROX-STATE]"
            << "mumble=" + mumbleName
            << "dim=" + state.dimension
            << QString("pos=%1,%2,%3").arg(state.x, 0, 'f', 1).arg(state.y, 0, 'f', 1).arg(state.z, 0, 'f', 1)
            << QString("range=%1").arg(state.rangeBlocks, 0, 'f', 1)
            << QString("mic=%1").arg(state.voiceEnabled ? QStringLiteral("on") : QStringLiteral("off"))
            << QString("level=%1").arg(state.attenuationLevel)
            << QString("tracked=%1").arg(playerCount());
    }
}

void removePlayer(const QString &mumbleName) {
    QWriteLocker locker(&g_lock);
    g_players.remove(keyFor(mumbleName));
}

void clearPlayers() {
    QWriteLocker locker(&g_lock);
    g_players.clear();
}

void touchPlayers() {
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    QWriteLocker locker(&g_lock);
    for (auto it = g_players.begin(); it != g_players.end(); ++it) {
        it.value().updatedAtMs = now;
    }
}

int playerCount() {
    QReadLocker locker(&g_lock);
    return g_players.size();
}

float attenuationFactor(const QString &speakerName, const QString &listenerName) {
    if (!isEnabled()) return 1.0F;

    const QString speakerKey = keyFor(speakerName);
    const QString listenerKey = keyFor(listenerName);
    const qint64 now = QDateTime::currentMSecsSinceEpoch();

    auto finish = [&](float factor, const QString &reason, const QString &extra = QString()) -> float {
        if (shouldLog(g_lastRouteLogMs, now, 1000)) {
            qWarning().noquote()
                << "[VC-PROX-ROUTE]"
                << "speaker=" + speakerName
                << "listener=" + listenerName
                << "reason=" + reason
                << QString("factor=%1").arg(factor, 0, 'f', 3)
                << extra;
        }
        return factor;
    };

    if (speakerKey.isEmpty() || listenerKey.isEmpty()) return finish(0.0F, "empty-name");

    QReadLocker locker(&g_lock);
    const auto speakerIt = g_players.constFind(speakerKey);
    const auto listenerIt = g_players.constFind(listenerKey);
    if (speakerIt == g_players.constEnd()) return finish(0.0F, "speaker-not-tracked", "tracked=" + QString::number(g_players.size()));
    if (listenerIt == g_players.constEnd()) return finish(0.0F, "listener-not-tracked", "tracked=" + QString::number(g_players.size()));

    const PlayerState speaker = speakerIt.value();
    const PlayerState listener = listenerIt.value();
    locker.unlock();

    if (!isFresh(speaker, now)) return finish(0.0F, "speaker-stale");
    if (!isFresh(listener, now)) return finish(0.0F, "listener-stale");
    if (!speaker.voiceEnabled) return finish(0.0F, "speaker-mic-off");
    if (speakerKey == listenerKey) return finish(1.0F, "self");
    if (speaker.dimension.isEmpty() || speaker.dimension != listener.dimension) {
        return finish(0.0F, "dimension-mismatch", "speakerDim=" + speaker.dimension + " listenerDim=" + listener.dimension);
    }

    const double range = static_cast<double>(speaker.rangeBlocks);
    if (range <= 0.0) return finish(0.0F, "range-zero");

    const double dx = speaker.x - listener.x;
    const double dy = speaker.y - listener.y;
    const double dz = speaker.z - listener.z;
    const double distanceSquared = dx * dx + dy * dy + dz * dz;
    const double distance = std::sqrt(distanceSquared);
    if (distanceSquared >= range * range) {
        return finish(0.0F, "out-of-range",
                      QString("distance=%1 range=%2").arg(distance, 0, 'f', 2).arg(range, 0, 'f', 2));
    }

    const double normalizedDistance = distance / range;
    const float factor = attenuationForNormalizedDistance(normalizedDistance, speaker.attenuationLevel);
    return finish(factor, "routed",
                  QString("distance=%1 range=%2 level=%3 mic=%4")
                      .arg(distance, 0, 'f', 2)
                      .arg(range, 0, 'f', 2)
                      .arg(speaker.attenuationLevel)
                      .arg(speaker.voiceEnabled ? QStringLiteral("on") : QStringLiteral("off")));
}

bool shouldRoute(const QString &speakerName, const QString &listenerName) {
    return attenuationFactor(speakerName, listenerName) > 0.0F;
}

} // namespace VCProximity
