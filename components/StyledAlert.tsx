import React, { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export interface StyledAlertInputConfig {
  enabled: boolean;
  initialValue?: string;
  placeholder?: string;
  maxLength?: number;
  submitText?: string;
  cancelText?: string;
  submitting?: boolean;
  onSubmit?: (value: string) => void;
}

export interface StyledAlertProps {
  visible: boolean;
  title: string;
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning' | 'question';
  buttonLayout?: 'row' | 'stacked';
  buttons?: Array<{
    text: string;
    onPress?: () => void;
    style?: 'default' | 'cancel' | 'destructive';
  }>;
  inputConfig?: StyledAlertInputConfig;
  onClose?: () => void;
}

const StyledAlert: React.FC<StyledAlertProps> = ({
  visible,
  title,
  message,
  type = 'info',
  buttonLayout = 'row',
  buttons,
  inputConfig,
  onClose,
}) => {
  const [inputValue, setInputValue] = useState('');
  const defaultButtons = buttons || [{ text: 'OK', onPress: onClose, style: 'default' }];
  const isInputMode = !!inputConfig?.enabled;
  const isStackedMode = !isInputMode && buttonLayout === 'stacked';

  useEffect(() => {
    if (visible && isInputMode) {
      setInputValue(inputConfig?.initialValue || '');
    }
  }, [visible, isInputMode, inputConfig?.initialValue]);

  const getIconName = () => {
    switch (type) {
      case 'success':
        return 'check-circle';
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'question':
        return 'help';
      default:
        return 'info';
    }
  };

  const getIconColor = () => {
    switch (type) {
      case 'success':
        return '#16A34A';
      case 'error':
        return '#DC2626';
      case 'warning':
        return '#EA580C';
      case 'question':
        return '#2563EB';
      default:
        return '#553C9A';
    }
  };

  const getButtonColor = (style?: string) => {
    if (style === 'destructive') return '#DC2626';
    if (style === 'cancel') return '#6B7280';
    return '#553C9A';
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.alertContainer}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            <MaterialIcons 
              name={getIconName() as any} 
              size={48} 
              color={getIconColor()} 
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>{title}</Text>

          {/* Message */}
          <Text style={styles.message}>{message}</Text>

          {/* Optional prompt input */}
          {isInputMode && (
            <TextInput
              style={styles.inputField}
              value={inputValue}
              onChangeText={setInputValue}
              placeholder={inputConfig?.placeholder || 'Enter value'}
              placeholderTextColor="#9CA3AF"
              maxLength={inputConfig?.maxLength || 60}
              autoFocus
            />
          )}

          {/* Buttons */}
          <View style={[
            styles.buttonContainer,
            isInputMode && styles.inputButtonContainer,
            isStackedMode && styles.stackedButtonContainer,
          ]}>
            {isInputMode ? (
              <>
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.singleButton,
                    styles.inputSubmitButton,
                    inputConfig?.submitting && styles.buttonDisabled,
                  ]}
                  onPress={() => inputConfig?.onSubmit?.(inputValue)}
                  disabled={inputConfig?.submitting}
                  activeOpacity={0.85}
                >
                  {inputConfig?.submitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.buttonText}>{inputConfig?.submitText || 'OK'}</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.inputCancelWrap}
                  onPress={onClose}
                  disabled={inputConfig?.submitting}
                >
                  <Text style={styles.inputCancelText}>{inputConfig?.cancelText || 'Cancel'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              defaultButtons.map((button, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.button,
                    (defaultButtons.length === 1 || isStackedMode) && styles.singleButton,
                    isStackedMode && styles.stackedButton,
                    isStackedMode && button.style === 'cancel' && styles.stackedCancelButton,
                    {
                      backgroundColor: getButtonColor(button.style),
                      flex: defaultButtons.length > 1 && !isStackedMode ? 1 : undefined,
                    },
                  ]}
                  onPress={() => {
                    if (button.onPress) {
                      button.onPress();
                    }
                    onClose?.();
                  }}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      button.style === 'destructive' && styles.destructiveButtonText,
                      isStackedMode && button.style === 'cancel' && styles.stackedCancelText,
                    ]}
                  >
                    {button.text}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    maxWidth: 320,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconContainer: {
    marginBottom: 16,
  },
  title: {
    fontSize: 19,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  message: {
    fontSize: 15,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  inputField: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
    marginBottom: 16,
  },
  buttonContainer: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  inputButtonContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  stackedButtonContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  singleButton: {
    minWidth: 140,
    alignSelf: 'center',
  },
  stackedButton: {
    minWidth: 170,
    borderRadius: 8,
  },
  stackedCancelButton: {
    borderRadius: 8,
  },
  inputSubmitButton: {
    minWidth: 160,
    borderRadius: 10,
    backgroundColor: '#553C9A',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  destructiveButtonText: {
    color: '#FFFFFF',
  },
  stackedCancelText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  inputCancelWrap: {
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  inputCancelText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default StyledAlert;
