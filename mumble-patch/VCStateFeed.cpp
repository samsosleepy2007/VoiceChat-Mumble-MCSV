#include "VCStateFeed.h"
#include "VCProximity.h"

#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QNetworkDatagram>
#include <QDebug>

VCStateFeed::VCStateFeed(QObject *parent)
    : QObject(parent), m_socket(this) {
    QObject::connect(
        &m_socket,
        &QUdpSocket::readyRead,
        this,
        [this]() { readPendingDatagrams(); }
    );
}

bool VCStateFeed::start(quint16 port) {
    VCProximity::setStaleTimeoutMs(45000);
    VCProximity::setEnabled(true);
    VCProximity::clearPlayers();

    const bool ok = m_socket.bind(
        QHostAddress::LocalHost,
        port,
        QUdpSocket::DontShareAddress
    );
    if (ok) {
        qWarning().noquote() << "[VC-PROX-FEED]"
                             << "listening=127.0.0.1:" + QString::number(port);
    } else {
        qCritical().noquote() << "[VC-PROX-FEED]"
                              << "bind-error=" + m_socket.errorString();
    }
    return ok;
}

void VCStateFeed::readPendingDatagrams() {
    while (m_socket.hasPendingDatagrams()) {
        const QNetworkDatagram datagram = m_socket.receiveDatagram();
        if (!datagram.isValid()) {
            continue;
        }
        if (datagram.senderAddress() != QHostAddress::LocalHost
            && datagram.senderAddress() != QHostAddress::LocalHostIPv6) {
            continue;
        }
        applyDatagram(datagram.data());
    }
}

void VCStateFeed::applyDatagram(const QByteArray &payload) {
    if (payload.size() > 262144) {
        return;
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(payload, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        return;
    }

    const QJsonObject data = document.object();
    const QString type = data.value(QStringLiteral("type")).toString();

    if (type == QStringLiteral("sync_begin")
        || type == QStringLiteral("bridge_disconnected")) {
        VCProximity::setEnabled(true);
        VCProximity::clearPlayers();
        VCProximity::clearCalls();
        return;
    }

    if (type == QStringLiteral("heartbeat")) {
        VCProximity::touchPlayers();
        return;
    }

    if (type == QStringLiteral("player_leave")) {
        QString mumbleName = data.value(QStringLiteral("mumbleName")).toString().trimmed();
        if (mumbleName.isEmpty()) {
            mumbleName = data.value(QStringLiteral("name")).toString().trimmed();
        }
        if (!mumbleName.isEmpty()) {
            VCProximity::removePlayer(mumbleName);
        }
        return;
    }

    if (type == QStringLiteral("call_end")) {
        const QString callId = data.value(QStringLiteral("callId")).toString().trimmed();
        if (!callId.isEmpty()) {
            VCProximity::removeCall(callId);
        }
        return;
    }

    if (type == QStringLiteral("call_state")) {
        const QString callId = data.value(QStringLiteral("callId")).toString().trimmed();
        const QString partyA = data.value(QStringLiteral("partyA")).toString().trimmed();
        const QString partyB = data.value(QStringLiteral("partyB")).toString().trimmed();
        const bool speakerA = data.value(QStringLiteral("speakerA")).toBool(false);
        const bool speakerB = data.value(QStringLiteral("speakerB")).toBool(false);
        if (!callId.isEmpty() && !partyA.isEmpty() && !partyB.isEmpty()) {
            VCProximity::updateCall(callId, partyA, partyB, speakerA, speakerB);
        }
        return;
    }

    if (type != QStringLiteral("player_state")) {
        return;
    }

    QString mumbleName = data.value(QStringLiteral("mumbleName")).toString().trimmed();
    if (mumbleName.isEmpty()) {
        mumbleName = data.value(QStringLiteral("name")).toString().trimmed();
    }
    const QString dimension = data.value(QStringLiteral("dimension")).toString().trimmed();

    const double x = data.value(QStringLiteral("x")).toDouble(qQNaN());
    const double y = data.value(QStringLiteral("y")).toDouble(qQNaN());
    const double z = data.value(QStringLiteral("z")).toDouble(qQNaN());

    int range = data.value(QStringLiteral("voiceRange")).toInt(30);
    int attenuationLevel = data.value(QStringLiteral("attenuationLevel")).toInt(2);
    // Never interpret absent or malformed mic state as enabled.
    const bool voiceEnabled = data.value(QStringLiteral("voiceEnabled")).toBool(false);

    if (mumbleName.isEmpty() || dimension.isEmpty()
        || !qIsFinite(x) || !qIsFinite(y) || !qIsFinite(z)) {
        return;
    }
    if (range < 1) {
        range = 30;
    }
    attenuationLevel = qBound(0, attenuationLevel, 4);

    VCProximity::updatePlayer(
        mumbleName,
        dimension,
        x,
        y,
        z,
        static_cast<float>(range),
        voiceEnabled,
        attenuationLevel
    );
}
