import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { CATEGORIES } from "@sinaly/shared";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sinaly</Text>
      <Text>Categorias: {CATEGORIES.join(", ")}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 8 },
});
