// lib/login_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:google_sign_in/google_sign_in.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({Key? key}) : super(key: key);
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _isSigningIn = false;

  Future<void> _signInWithGoogle() async {
    setState(() {
      _isSigningIn = true;
    });

    try {
      // 1) Force a sign-out to always show account chooser
      await GoogleSignIn().signOut();

      // 2) Trigger the Google Sign-In flow
      final GoogleSignInAccount? googleUser = await GoogleSignIn().signIn();
      if (googleUser == null) {
        // User cancelled the chooser
        if (!mounted) return;
        setState(() {
          _isSigningIn = false;
        });
        return;
      }

      // 3) Obtain the auth details (idToken + accessToken)
      final GoogleSignInAuthentication googleAuth =
          await googleUser.authentication;

      // 4) Create a Firebase credential
      final credential = GoogleAuthProvider.credential(
        idToken: googleAuth.idToken,
        accessToken: googleAuth.accessToken,
      );

      // 5) Sign in to Firebase with that credential
      final userCredential =
          await FirebaseAuth.instance.signInWithCredential(credential);

      // 6) Mirror into /users/{uid} if not already present
      final User? user = userCredential.user;
      if (user != null) {
        final uid = user.uid;
        final userRef = FirebaseDatabase.instance.ref('users/$uid');

        // Check if /users/$uid exists
        final snapshot = await userRef.get();
        if (!snapshot.exists) {
          // Write minimal info: email + displayName (if any)
          await userRef.set({
            'email': user.email ?? '',
            'displayName': user.displayName ?? '',
          });
        }
      }

      // We do NOT need to call setState to hide the spinner,
      // because the authStateChanges() listener in main.dart
      // will re-route us to HomeScreen immediately.

    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Sign in failed: $e'),
          backgroundColor: Colors.redAccent,
        ),
      );
      if (mounted) {
        setState(() {
          _isSigningIn = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Banamaduwa Login'),
        centerTitle: true,
      ),
      body: Center(
        child: _isSigningIn
            ? const CircularProgressIndicator()
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // ───── Local Asset Logo ─────
                  Image.asset(
                    'assets/logo.png',
                    width: 400,
                    height: 200,
                    fit: BoxFit.contain,
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Welcome to\nBanamaduwa Automation',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 48),

                  // ───── “Sign in with Google” Button ─────
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: Colors.black87,
                      minimumSize: const Size(240, 50),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    icon: Image.asset(
                      'assets/g.png',
                      height: 24,
                      width: 24,
                    ),
                    label: const Text('Sign in with Google'),
                    onPressed: _signInWithGoogle,
                  ),
                ],
              ),
      ),
    );
  }
}
