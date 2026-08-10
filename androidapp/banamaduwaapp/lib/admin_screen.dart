// lib/admin_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';

class AdminScreen extends StatefulWidget {
  const AdminScreen({Key? key}) : super(key: key);

  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> {
  final FirebaseAuth _auth = FirebaseAuth.instance;

  bool? _isAdmin; // null = loading, false = not admin, true = admin
  late final DatabaseReference _adminRef;

  // Form state
  String? _selectedUserUid;        // The actual UID of the selected user
  String? _selectedDeviceFullPath; // "houseId/deviceId"

  @override
  void initState() {
    super.initState();
    final currentUser = _auth.currentUser;
    if (currentUser != null) {
      _adminRef = FirebaseDatabase.instance.ref('admins/${currentUser.uid}');
      _adminRef.onValue.listen((event) {
        final val = event.snapshot.value;
        setState(() {
          _isAdmin = (val == true);
        });
      });
    } else {
      _isAdmin = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isAdmin == null) {
      // Still checking admin status
      return Scaffold(
        appBar: AppBar(title: const Text('Admin Panel')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_isAdmin == false) {
      // Not an admin
      return Scaffold(
        appBar: AppBar(title: const Text('Admin Panel')),
        body: const Center(
          child: Text(
            'Not authorized.\nOnly admins may view this page.',
            style: TextStyle(color: Colors.white70),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    // Admin → show UI
    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin Panel'),
        centerTitle: true,
      ),
      body: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // ───── “Select User” (friendly names) ─────
            const Text(
              'Select User',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Colors.white70,
              ),
            ),
            const SizedBox(height: 8),

            StreamBuilder<DatabaseEvent>(
              stream: FirebaseDatabase.instance.ref('users').onValue,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Text(
                    'Error loading users: ${snapshot.error}',
                    style: const TextStyle(color: Colors.redAccent),
                  );
                }

                final usersSnap = snapshot.data?.snapshot;
                if (usersSnap == null || usersSnap.value == null) {
                  return const Text(
                    'No registered users found.',
                    style: TextStyle(color: Colors.white70),
                  );
                }

                // usersSnap.value is { uid1: { email: "...", displayName: "..." }, ... }
                final Map<dynamic, dynamic> usersMap =
                    usersSnap.value as Map<dynamic, dynamic>;

                // Build a list of (uid, friendlyLabel) pairs
                final List<MapEntry<String, String>> userEntries = usersMap.entries
                    .map((e) {
                      final uid = e.key.toString();
                      final data = e.value as Map<dynamic, dynamic>;
                      final displayName = (data['displayName'] ?? '').toString();
                      final email = (data['email'] ?? '').toString();
                      final label = displayName.isNotEmpty
                          ? '$displayName ($email)'
                          : email; // fallback to email if displayName empty
                      return MapEntry(uid, label);
                    })
                    .toList()
                      ..sort((a, b) => a.value.toLowerCase().compareTo(b.value.toLowerCase()));

                // Initialize _selectedUserUid if not already set
                if (_selectedUserUid == null && userEntries.isNotEmpty) {
                  _selectedUserUid = userEntries.first.key;
                }

                return DropdownButtonFormField<String>(
                  value: _selectedUserUid,
                  dropdownColor: Colors.grey[900],
                  decoration: InputDecoration(
                    labelText: 'User (displayName / email)',
                    labelStyle: const TextStyle(color: Colors.white70),
                    filled: true,
                    fillColor: Colors.grey[800],
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                      borderSide: BorderSide.none,
                    ),
                  ),
                  items: userEntries
                      .map(
                        (entry) => DropdownMenuItem<String>(
                          value: entry.key,
                          child: Text(entry.value,
                              style: const TextStyle(color: Colors.white)),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    setState(() {
                      _selectedUserUid = value;
                    });
                  },
                );
              },
            ),

            const SizedBox(height: 16),

            // ───── “Select Device” (house/device) ─────
            const Text(
              'Select Device (House/Device)',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Colors.white70,
              ),
            ),
            const SizedBox(height: 8),

            StreamBuilder<DatabaseEvent>(
              stream: FirebaseDatabase.instance.ref('houses').onValue,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Text(
                    'Error loading houses/devices: ${snapshot.error}',
                    style: const TextStyle(color: Colors.redAccent),
                  );
                }
                final housesSnap = snapshot.data?.snapshot;
                if (housesSnap == null || housesSnap.value == null) {
                  return const Text(
                    'No houses/devices found.',
                    style: TextStyle(color: Colors.white70),
                  );
                }

                final Map<dynamic, dynamic> housesMap =
                    housesSnap.value as Map<dynamic, dynamic>;
                final List<String> allDevicePaths = [];
                housesMap.forEach((houseKey, houseVal) {
                  final houseId = houseKey.toString();
                  if (houseVal is Map && houseVal['devices'] is Map) {
                    final Map<dynamic, dynamic> devMap =
                        houseVal['devices'] as Map<dynamic, dynamic>;
                    devMap.keys.forEach((devKey) {
                      final deviceId = devKey.toString();
                      allDevicePaths.add('$houseId/$deviceId');
                    });
                  }
                });

                allDevicePaths.sort();
                if (_selectedDeviceFullPath == null &&
                    allDevicePaths.isNotEmpty) {
                  _selectedDeviceFullPath = allDevicePaths.first;
                }

                return DropdownButtonFormField<String>(
                  value: _selectedDeviceFullPath,
                  dropdownColor: Colors.grey[900],
                  decoration: InputDecoration(
                    labelText: 'House/Device',
                    labelStyle: const TextStyle(color: Colors.white70),
                    filled: true,
                    fillColor: Colors.grey[800],
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                      borderSide: BorderSide.none,
                    ),
                  ),
                  items: allDevicePaths
                      .map(
                        (path) => DropdownMenuItem<String>(
                          value: path,
                          child: Text(path,
                              style: const TextStyle(color: Colors.white)),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    setState(() {
                      _selectedDeviceFullPath = value;
                    });
                  },
                );
              },
            ),

            const SizedBox(height: 16),

            // ───── “Assign Device” Button ─────
            ElevatedButton(
              onPressed: (_selectedUserUid != null &&
                      _selectedDeviceFullPath != null)
                  ? () async {
                      final parts = _selectedDeviceFullPath!.split('/');
                      final houseId = parts[0];
                      final deviceId = parts[1];
                      final assignRef = FirebaseDatabase.instance
                          .ref(
                              'user_access/$_selectedUserUid/$deviceId/$houseId');
                      try {
                        await assignRef.set(true);
                        if (ScaffoldMessenger.maybeOf(context) != null) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Assignment saved.',
                                style: TextStyle(color: Colors.black87),
                              ),
                              backgroundColor: Colors.greenAccent,
                            ),
                          );
                        }
                      } catch (e) {
                        if (ScaffoldMessenger.maybeOf(context) != null) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content:
                                  Text('Failed to assign: ${e.toString()}'),
                              backgroundColor: Colors.redAccent,
                            ),
                          );
                        }
                      }
                    }
                  : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.tealAccent,
                foregroundColor: Colors.black87,
                minimumSize: const Size.fromHeight(45),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(6),
                ),
              ),
              child: const Text('Assign Device'),
            ),

            const SizedBox(height: 24),
            const Divider(color: Colors.white24),
            const SizedBox(height: 12),

            // ───── “Assigned Devices” for Selected User ─────
            const Text(
              'Assigned Devices',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Colors.white70,
              ),
            ),
            const SizedBox(height: 8),

            if (_selectedUserUid == null)
              const Center(
                child: Text(
                  'Select a user above to see assignments.',
                  style: TextStyle(color: Colors.white70),
                ),
              )
            else
              Expanded(
                child: StreamBuilder<DatabaseEvent>(
                  stream: FirebaseDatabase.instance
                      .ref('user_access/$_selectedUserUid')
                      .onValue,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState ==
                        ConnectionState.waiting) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    if (snapshot.hasError) {
                      return Center(
                        child: Text(
                          'Error loading assignments: ${snapshot.error}',
                          style: const TextStyle(color: Colors.redAccent),
                        ),
                      );
                    }

                    final uaSnap = snapshot.data?.snapshot;
                    if (uaSnap == null || uaSnap.value == null) {
                      return const Center(
                        child: Text(
                          'No assignments for this user.',
                          style: TextStyle(color: Colors.white70),
                        ),
                      );
                    }

                    // uaSnap.value is { deviceId: { houseId: true, … }, … }
                    final Map<dynamic, dynamic> deviceMap =
                        uaSnap.value as Map<dynamic, dynamic>;
                    final List<_AssignmentEntry> assignedList = [];

                    deviceMap.forEach((devKey, houseMap) {
                      final deviceId = devKey.toString();
                      if (houseMap is Map) {
                        houseMap.forEach((houseKey, _) {
                          final houseId = houseKey.toString();
                          assignedList.add(
                            _AssignmentEntry(
                              deviceId: deviceId,
                              houseId: houseId,
                            ),
                          );
                        });
                      }
                    });

                    if (assignedList.isEmpty) {
                      return const Center(
                        child: Text(
                          'No assignments for this user.',
                          style: TextStyle(color: Colors.white70),
                        ),
                      );
                    }

                    return ListView.builder(
                      itemCount: assignedList.length,
                      itemBuilder: (context, index) {
                        final entry = assignedList[index];
                        return Card(
                          color: Colors.grey[850],
                          margin: const EdgeInsets.symmetric(
                              vertical: 4, horizontal: 0),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: ListTile(
                            title: Text(
                              'Device: ${entry.deviceId}',
                              style: const TextStyle(
                                  color: Colors.white, fontSize: 16),
                            ),
                            subtitle: Text(
                              'House: ${entry.houseId}',
                              style: const TextStyle(
                                  color: Colors.white70, fontSize: 14),
                            ),
                            trailing: IconButton(
                              icon: const Icon(Icons.delete_outline,
                                  color: Colors.redAccent),
                              tooltip: 'Remove',
                              onPressed: () async {
                                final removeRef = FirebaseDatabase.instance
                                    .ref(
                                        'user_access/$_selectedUserUid/${entry.deviceId}/${entry.houseId}');
                                try {
                                  await removeRef.remove();
                                  if (ScaffoldMessenger.maybeOf(context) !=
                                      null) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text(
                                          'Removed assignment.',
                                          style: TextStyle(
                                              color: Colors.black87),
                                        ),
                                        backgroundColor:
                                            Colors.greenAccent,
                                      ),
                                    );
                                  }
                                } catch (e) {
                                  if (ScaffoldMessenger.maybeOf(context) !=
                                      null) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text(
                                            'Failed to remove: ${e.toString()}'),
                                        backgroundColor:
                                            Colors.redAccent,
                                      ),
                                    );
                                  }
                                }
                              },
                            ),
                          ),
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

class _AssignmentEntry {
  final String deviceId;
  final String houseId;
  _AssignmentEntry({required this.deviceId, required this.houseId});
}
