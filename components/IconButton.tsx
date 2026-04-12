import { TouchableOpacity, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface IconButtonProps {
  onPress: () => void;
  icon?: string; // MaterialIcons icon name or custom mapped names
  size?: number;
  color?: string;
  style?: any;
  testID?: string;
}

// Map custom icon names to MaterialIcons names
const iconMap: { [key: string]: string } = {
  add: 'add',
  alert: 'notifications-active',
  devices: 'devices',
  profile: 'account-circle',
  home: 'home',
  sensors: 'sensors',
  settings: 'settings',
  'arrow-back': 'arrow-back',
  info: 'info',
  logout: 'logout',
  edit: 'edit',
  delete: 'delete',
  close: 'close',
  check: 'check',
};

export default function IconButton({
  onPress,
  icon = 'home',
  size = 24,
  color = '#FFFFFF',
  style,
  testID,
}: IconButtonProps) {
  // Get the MaterialIcons name from the map, or use the icon prop directly
  const iconName = iconMap[icon] || icon;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.button, style]}
      testID={testID}
      activeOpacity={0.7}
    >
      <MaterialIcons
        name={iconName as any}
        size={size}
        color={color}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
  },
});
