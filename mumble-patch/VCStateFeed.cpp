#include "VCStateFeed.h"
#include "VCProximity.h"

#include <QDateTime>
#include <QHostAddress>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QNetworkDatagram>
#include <QDebug>

VCStateFeed::VCStateFeed(QObject *parent)
    : QObject(parent), m_socket(this), m_talkTimer(this) {
    // VC_TALK_FEED: report who is sending voice back to the plugin's socket.
    m_talkTimer.setInterval(100);
    QObject::connect(&m_talkTimer, &QTimer::timeout, this, [this]() { publishTalkers(); });
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
        m_talkTimer.start();
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
        m_replyAddress = datagram.senderAddress();
        m_replyPort = static_cast< quint16 >(datagram.senderPort());
        applyDatagram(datagram.data());
    }
}

void VCStateFeed::publishTalkers() {
    if (m_replyPort == 0) {
        return;
    }
    // Hold 400 ms after the last packet so short pauses between words do not flicker.
    const QStringList talkers = VCProximity::activeTalkers(400);
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (talkers == m_lastTalkers && now - m_lastTalkSentMs < 2000) {
        return;
    }
    if (talkers != m_lastTalkers) {
        qWarning().noquote() << "[VC-TALK]" << "talkers=" + (talkers.isEmpty() ? QStringLiteral("-") : talkers.join(QLatin1Char(',')));
    }
    m_lastTalkers = talkers;
    m_lastTalkSentMs = now;
    QJsonObject message;
    message.insert(QStringLiteral("type"), QStringLiteral("talking"));
    message.insert(QStringLiteral("names"), QJsonArray::fromStringList(talkers));
    m_socket.writeDatagram(QJsonDocument(message).toJson(QJsonDocument::Compact), m_replyAddress, m_replyPort);
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
    const bool voiceEnabled = data.value(QStringLiteral("voiceEnabled")).toBool(true);

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
