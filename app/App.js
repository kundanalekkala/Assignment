
import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Text,
  View,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';

const SERVER = 'https://customs-accustom-precise.ngrok-free.dev';

export default function App() {
  const [leads, setLeads] = useState([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    // Load existing leads when the screen opens.
    fetch(`${SERVER}/leads`, {
      headers: { 'ngrok-skip-browser-warning': '1' },
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        if (active) {
          setLeads(Array.isArray(data) ? data : []);
          setError('');
        }
      })
      .catch(err => {
        if (active) setError(err.message);
        console.warn('Failed to load leads:', err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // Connect to the backend for live updates.
    const socket = io(SERVER, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      extraHeaders: {
        'ngrok-skip-browser-warning': '1',
      },
    });

    socket.on('connect', () => {
      if (active) {
        setConnected(true);
        console.log('Socket connected:', socket.id);
      }
    });

    socket.on('disconnect', reason => {
      if (active) setConnected(false);
      console.log('Socket disconnected:', reason);
    });

    socket.on('connect_error', err => {
      if (active) setConnected(false);
      console.warn('Socket connection error:', err.message);
    });

    socket.on('lead:new', lead => {
      if (!active || !lead?.id) return;

      setLeads(previous => [
        lead,
        ...previous.filter(item => item.id !== lead.id),
      ]);
    });

    return () => {
      active = false;
      socket.disconnect();
    };
  }, []);

  const getName = lead =>
    lead.fields?.full_name ||
    [lead.fields?.first_name, lead.fields?.last_name]
      .filter(Boolean)
      .join(' ') ||
    lead.full_name ||
    'Unknown';

  const renderLead = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.name}>{getName(item)}</Text>
      <Text>{item.fields?.email || 'No email'}</Text>
      <Text>{item.fields?.phone_number || 'No phone number'}</Text>
      <Text style={styles.time}>
        {item.createdTime
          ? new Date(item.createdTime).toLocaleString()
          : 'Time unavailable'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Meta Leads</Text>
          <Text style={styles.subtitle}>
            {leads.length} leads received
          </Text>
        </View>

        <Text
          style={{
            color: connected ? '#16a34a' : '#dc2626',
            fontWeight: '600',
          }}
        >
          {connected ? '● Live' : '● Offline'}
        </Text>
      </View>

      {loading && <ActivityIndicator style={styles.loader} />}

      {!!error && (
        <Text style={styles.error}>
          Could not load leads: {error}
        </Text>
      )}

      <FlatList
        data={leads}
        keyExtractor={item => String(item.id)}
        renderItem={renderLead}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>
              {connected
                ? 'Waiting for new leads…'
                : 'Connecting to server…'}
            </Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: '#6b7280',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    elevation: 2,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  time: {
    color: '#6b7280',
    marginTop: 8,
    fontSize: 12,
  },
  empty: {
    textAlign: 'center',
    marginTop: 50,
    color: '#6b7280',
  },
  error: {
    color: '#dc2626',
    paddingHorizontal: 16,
  },
  loader: {
    marginVertical: 12,
  },
  list: {
    paddingBottom: 20,
  },
});
