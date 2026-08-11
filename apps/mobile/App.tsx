import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>FYC</Text>
      <Text style={styles.subtitle}>App del chofer/depósito.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0C0A09",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
  title: {
    color: "#FAFAF9",
    fontSize: 28,
    fontWeight: "600",
  },
  subtitle: {
    color: "#78716C",
    fontSize: 16,
    textAlign: "center",
  },
});
