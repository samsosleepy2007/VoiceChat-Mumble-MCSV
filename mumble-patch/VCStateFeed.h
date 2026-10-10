#pragma once

#include <QHostAddress>
#include <QObject>
#include <QStringList>
#include <QTimer>
#include <QUdpSocket>

class VCStateFeed final : public QObject {
public:
    explicit VCStateFeed(QObject *parent = nullptr);
    bool start(quint16 port);

private:
    void readPendingDatagrams();
    void applyDatagram(const QByteArray &payload);
    void publishTalkers();

    QTimer m_talkTimer;
    QHostAddress m_replyAddress;
    quint16 m_replyPort = 0;
    QStringList m_lastTalkers;
    qint64 m_lastTalkSentMs = 0;

    QUdpSocket m_socket;
};
