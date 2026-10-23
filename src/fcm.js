// @ts-check

import { initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { cert } from 'firebase-admin/app';

let messaging = null;

export function initFCM() {
  if (messaging) return messaging;
  
  const serviceAccount = process.env.FCM_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    console.warn('FCM_SERVICE_ACCOUNT not set, push notifications disabled');
    return null;
  }
  
  try {
    const parsed = JSON.parse(serviceAccount);
    initializeApp({ credential: cert(parsed) });
    messaging = getMessaging();
    console.log('FCM initialized successfully');
    return messaging;
  } catch (err) {
    console.error('Failed to initialize FCM:', err);
    return null;
  }
}

export async function sendCallPush(fcmToken, callData) {
  if (!messaging) {
    const initResult = initFCM();
    if (!initResult) return false;
  }
  
  try {
    const data = {
      type: 'callIncoming',
      callId: callData.callId,
      channelId: String(callData.channelId),
      mode: callData.mode,
      peerId: String(callData.peer.id),
      peerName: callData.peer.username,
      peerAvatar: callData.peer.avatarUrl || '',
    }
    if (callData.keyPackage) {
      data.keyPackage = callData.keyPackage
    }
    
    await messaging.send({
      token: fcmToken,
      data,
      android: {
        priority: 'high',
        notification: {
          title: 'Входящий вызов',
          body: `${callData.peer.username} звонит...`,
          icon: 'ic_notification',
          channelId: 'calls',
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: 'Входящий вызов',
              body: `${callData.peer.username} звонит...`,
            },
            sound: 'default',
            category: 'CALL_INCOMING',
          },
        },
      },
    });
    return true;
  } catch (err) {
    console.error('Failed to send FCM push:', err);
    return false;
  }
}

export async function sendMessagePush(fcmToken, messageData) {
  if (!messaging) {
    const initResult = initFCM();
    if (!initResult) return false;
  }
  
  try {
    await messaging.send({
      token: fcmToken,
      data: {
        type: 'newMessage',
        messageId: String(messageData.id),
        channelId: String(messageData.channelId),
        senderId: String(messageData.userId),
        senderName: messageData.username,
        preview: messageData.body || (messageData.attachment ? 'Вложение' : ''),
      },
      notification: {
        title: messageData.username,
        body: messageData.body || (messageData.attachment ? 'Вложение' : ''),
      },
    });
    return true;
  } catch (err) {
    console.error('Failed to send message FCM push:', err);
    return false;
  }
}

export async function sendGroupCallPush(fcmToken, callData) {
  if (!messaging) {
    const initResult = initFCM();
    if (!initResult) return false;
  }
  
  try {
    const data = {
      type: 'groupCallInvite',
      callId: callData.callId,
      channelId: String(callData.channelId),
      mode: callData.mode,
      creatorId: String(callData.creator.id),
      creatorName: callData.creator.username,
      creatorAvatar: callData.creator.avatarUrl || '',
    }
    
    await messaging.send({
      token: fcmToken,
      data,
      android: {
        priority: 'high',
        notification: {
          title: 'Групповой звонок',
          body: `${callData.creator.username} начал групповой ${callData.mode === 'video' ? 'видео' : 'голосовой'} чат`,
          icon: 'ic_notification',
          channelId: 'calls',
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: 'Групповой звонок',
              body: `${callData.creator.username} начал групповой ${callData.mode === 'video' ? 'видео' : 'голосовой'} чат`,
            },
            sound: 'default',
            category: 'CALL_INCOMING',
          },
        },
      },
    });
    return true;
  } catch (err) {
    console.error('Failed to send group call FCM push:', err);
    return false;
  }
}