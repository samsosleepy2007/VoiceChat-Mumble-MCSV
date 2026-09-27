#pragma once

#include <QObject>
#include <QUdpSocket>

class VCStateFeed final : public QObject {
public:
    explicit VCStateFeed(QObject *parent = nullptr);
    bool start(quint16 port);

private:
    void readPendingDatagrams();
    void applyDatagram(const QByteArray &payload);

    QUdpSocket m_socket;
};
