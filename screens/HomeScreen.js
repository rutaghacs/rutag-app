import React from "react";
import { View, Text, Button } from "react-native";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Welcome! You are logged in.</Text>
      <Button title="Logout" onPress={() => signOut(auth)} />
    </View>
  );
}
