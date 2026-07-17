import NetInfo from "@react-native-community/netinfo";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { useEffect } from "react";
import { AppState } from "react-native";

import { flushQueue, refreshQueueStatuses } from "@/lib/recording-queue";

const TASK_NAME = "medchina-recording-delivery-v1";

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      await flushQueue();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerDeliveryBackgroundTask(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
  } catch {
    // Background execution is opportunistic and unavailable in Expo Go/iOS
    // simulator. Foreground and connectivity listeners remain authoritative.
  }
}

export function useRecordingDelivery(): void {
  useEffect(() => {
    void registerDeliveryBackgroundTask();
    const network = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void flushQueue();
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void flushQueue();
        void refreshQueueStatuses();
      }
    });
    return () => {
      network();
      appState.remove();
    };
  }, []);
}
