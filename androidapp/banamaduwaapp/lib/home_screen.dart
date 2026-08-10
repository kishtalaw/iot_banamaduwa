// lib/home_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';

import 'admin_screen.dart'; // ← Make sure this file exists (see next section)

class HomeScreen extends StatefulWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  late final DatabaseReference _userAccessRef;
  String? _uid;

  bool _isAdmin = false;      // Tracks if the current user is an admin
  bool _checkedAdmin = false; // Tracks if we've finished checking admin status

  @override
  void initState() {
    super.initState();

    final user = _auth.currentUser;
    if (user != null) {
      _uid = user.uid;
      _userAccessRef = FirebaseDatabase.instance.ref('user_access/${user.uid}');

      // 1) Check once if /admins/{uid} == true
      FirebaseDatabase.instance
          .ref('admins/${user.uid}')
          .once()
          .then((event) {
        final val = event.snapshot.value;
        setState(() {
          _isAdmin = (val == true);
          _checkedAdmin = true;
        });
      }).catchError((_) {
        // If any error (e.g. permission denied), treat as not admin
        setState(() {
          _isAdmin = false;
          _checkedAdmin = true;
        });
      });
    } else {
      _checkedAdmin = true;
      _isAdmin = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_uid == null) {
      // If not signed in, force sign-out / loading
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _auth.signOut();
      });
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Banamaduwa Home'),
        centerTitle: true,
        actions: [
          // Only show the Admin icon if we've checked and the user is an admin
          if (_checkedAdmin && _isAdmin)
            IconButton(
              icon: const Icon(Icons.admin_panel_settings),
              tooltip: 'Admin Panel',
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (context) => const AdminScreen()),
                );
              },
            ),

          // Always show Logout
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Logout',
            onPressed: () async {
              await _auth.signOut();
            },
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Greeting
            Text(
              'Hello, ${_auth.currentUser?.email ?? 'Guest'}',
              style: const TextStyle(fontSize: 20, color: Colors.white),
            ),
            const SizedBox(height: 16),

            // “Your Devices”
            const Text(
              'Your Devices',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Colors.white70,
              ),
            ),
            const SizedBox(height: 8),

            // List devices from /user_access/{uid}
            Expanded(
              child: StreamBuilder<DatabaseEvent>(
                stream: _userAccessRef.onValue,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snapshot.hasError) {
                    return Center(
                      child: Text(
                        'Error loading devices: ${snapshot.error}',
                        style: const TextStyle(color: Colors.redAccent),
                      ),
                    );
                  }

                  final dataSnapshot = snapshot.data?.snapshot;
                  if (dataSnapshot == null || dataSnapshot.value == null) {
                    return const Center(
                      child: Text(
                        'No devices assigned.',
                        style: TextStyle(color: Colors.white70),
                      ),
                    );
                  }

                  // Build flattened (deviceId, houseId) pairs
                  final rawMap = dataSnapshot.value as Map<dynamic, dynamic>;
                  final List<_DeviceEntry> devices = [];
                  rawMap.forEach((deviceKey, houseMap) {
                    final deviceId = deviceKey.toString();
                    if (houseMap is Map) {
                      houseMap.forEach((houseKey, _) {
                        final houseId = houseKey.toString();
                        devices.add(_DeviceEntry(
                          deviceId: deviceId,
                          houseId: houseId,
                        ));
                      });
                    }
                  });

                  if (devices.isEmpty) {
                    return const Center(
                      child: Text(
                        'No devices assigned.',
                        style: TextStyle(color: Colors.white70),
                      ),
                    );
                  }

                  return ListView.builder(
                    itemCount: devices.length,
                    itemBuilder: (context, index) {
                      final entry = devices[index];
                      return _DeviceCard(
                        deviceId: entry.deviceId,
                        houseId: entry.houseId,
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Holds one (deviceId, houseId) pair
class _DeviceEntry {
  final String deviceId;
  final String houseId;
  _DeviceEntry({required this.deviceId, required this.houseId});
}

/// Each device card now listens to /houses/{houseId}/devices/{deviceId}
/// and shows two buttons (“Open”/“Close” if type == “gate”, or “ON”/“OFF” if type == “light”).
class _DeviceCard extends StatelessWidget {
  final String deviceId;
  final String houseId;

  const _DeviceCard({
    Key? key,
    required this.deviceId,
    required this.houseId,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final deviceRef = FirebaseDatabase.instance
        .ref('houses/$houseId/devices/$deviceId');

    return Card(
      color: Colors.grey[850],
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
        child: StreamBuilder<DatabaseEvent>(
          stream: deviceRef.onValue,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return Text(
                'Error: ${snapshot.error}',
                style: const TextStyle(color: Colors.redAccent),
              );
            }

            final ds = snapshot.data?.snapshot;
            if (ds == null || ds.value == null) {
              return Text(
                '$deviceId (not found)',
                style: const TextStyle(color: Colors.white70),
              );
            }

            final data = ds.value as Map<dynamic, dynamic>;
            final deviceType = data['type']?.toString().toLowerCase() ?? '';
            final currentState = data['state']?.toString().toLowerCase() ?? '';

            final bool isGate = deviceType == 'gate';
            final bool isLight = deviceType == 'light';

            final commandRef = FirebaseDatabase.instance
                .ref('houses/$houseId/devices/$deviceId/command');

            Future<void> _sendCommand(String cmd) async {
              try {
                await commandRef.set(cmd);
              } catch (e) {
                if (ScaffoldMessenger.maybeOf(context) != null) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Failed to send command: $e'),
                      backgroundColor: Colors.redAccent,
                    ),
                  );
                }
              }
            }

            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$deviceId  (House: $houseId)',
                  style: const TextStyle(
                    fontSize: 16,
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Type: ${deviceType.isEmpty ? 'Unknown' : deviceType}   │   State: ${currentState.isEmpty ? 'Unknown' : currentState}',
                  style: const TextStyle(
                    fontSize: 14,
                    color: Colors.white70,
                  ),
                ),
                const SizedBox(height: 12),

                // Two Buttons Row
                Row(
                  children: [
                    // “Activate” button: Open or ON
                    Expanded(
                      child: ElevatedButton(
                        onPressed: (isGate || isLight)
                            ? () {
                                final cmd = isGate ? 'OPEN' : 'ON';
                                _sendCommand(cmd);
                              }
                            : null,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.greenAccent,
                          foregroundColor: Colors.black87,
                          minimumSize: const Size.fromHeight(40),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(6),
                          ),
                        ),
                        child: Text(
                          isGate
                              ? 'Open'
                              : isLight
                                  ? 'ON'
                                  : 'N/A',
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    // “Deactivate” button: Close or OFF
                    Expanded(
                      child: ElevatedButton(
                        onPressed: (isGate || isLight)
                            ? () {
                                final cmd = isGate ? 'CLOSE' : 'OFF';
                                _sendCommand(cmd);
                              }
                            : null,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.redAccent,
                          foregroundColor: Colors.black87,
                          minimumSize: const Size.fromHeight(40),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(6),
                          ),
                        ),
                        child: Text(
                          isGate
                              ? 'Close'
                              : isLight
                                  ? 'OFF'
                                  : 'N/A',
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
