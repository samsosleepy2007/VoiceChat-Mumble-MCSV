// Native regression test for the actual VCProximity implementation.
// Run in CI with Qt6Core (no Minecraft server or voice clients required).
#include "VCProximity.h"

#include <QtCore/QCoreApplication>
#include <QtCore/QThread>

#include <cassert>

static void player(const char *name, bool on, double x) {
    VCProximity::updatePlayer(
        QString::fromUtf8(name), QStringLiteral("overworld"),
        x, 70.0, 0.0, 30.0F, on, 3
    );
}

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    VCProximity::setEnabled(true);
    VCProximity::setStaleTimeoutMs(45000);

    assert(!VCProximity::canSpeak(QStringLiteral("unknown")));
    assert(VCProximity::attenuationFactor(QStringLiteral("unknown"),
                                         QStringLiteral("listener")) == 0.0F);

    player("speaker", true, 0.0);
    player("listener", true, 4.0);
    assert(VCProximity::canSpeak(QStringLiteral("speaker")));
    assert(VCProximity::attenuationFactor(QStringLiteral("speaker"),
                                         QStringLiteral("listener")) > 0.0F);

    VCProximity::updateCall(QStringLiteral("call001"), QStringLiteral("speaker"),
                            QStringLiteral("listener"), true, true);
    assert(VCProximity::attenuationFactor(QStringLiteral("speaker"),
                                         QStringLiteral("listener")) > 0.0F);

    // An active call must never override Minecraft's Mic OFF state.
    player("speaker", false, 0.0);
    assert(!VCProximity::canSpeak(QStringLiteral("speaker")));
    assert(VCProximity::attenuationFactor(QStringLiteral("speaker"),
                                         QStringLiteral("listener")) == 0.0F);

    player("speaker", true, 0.0);
    VCProximity::setStaleTimeoutMs(1);
    QThread::msleep(15);
    assert(!VCProximity::canSpeak(QStringLiteral("speaker")));
    assert(VCProximity::attenuationFactor(QStringLiteral("speaker"),
                                         QStringLiteral("listener")) == 0.0F);

    VCProximity::setStaleTimeoutMs(45000);
    player("speaker", true, 0.0);
    VCProximity::removePlayer(QStringLiteral("speaker"));
    assert(!VCProximity::canSpeak(QStringLiteral("speaker")));

    player("speaker", true, 0.0);
    VCProximity::setEnabled(false);
    assert(!VCProximity::canSpeak(QStringLiteral("speaker")));
    assert(VCProximity::attenuationFactor(QStringLiteral("speaker"),
                                         QStringLiteral("listener")) == 0.0F);
    return 0;
}
