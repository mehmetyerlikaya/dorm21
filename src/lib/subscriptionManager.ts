import { supabase } from "./supabase"

type SubscriptionCallback = (table?: string, event?: string) => void

class SubscriptionManager {
  private static instance: SubscriptionManager
  private channel: any = null
  private callbacks: Set<SubscriptionCallback> = new Set()
  private isSubscribed = false
  private pollingInterval: NodeJS.Timeout | null = null
  private isDestroyed = false
  private subscriptionId = 0
  private lastChangeTime = 0

  static getInstance(): SubscriptionManager {
    if (!SubscriptionManager.instance) {
      SubscriptionManager.instance = new SubscriptionManager()
    }
    return SubscriptionManager.instance
  }

  addCallback(callback: SubscriptionCallback) {
    if (this.isDestroyed) return

    this.callbacks.add(callback)
    console.log(`📡 Added callback, total: ${this.callbacks.size}`)

    if (this.callbacks.size === 1 && !this.isSubscribed) {
      this.initializeSubscription()
    }
  }

  removeCallback(callback: SubscriptionCallback) {
    this.callbacks.delete(callback)
    console.log(`📡 Removed callback, total: ${this.callbacks.size}`)

    if (this.callbacks.size === 0) {
      this.cleanup()
    }
  }

  private async initializeSubscription() {
    if (this.isSubscribed || this.channel || this.isDestroyed) {
      return
    }

    console.log("🔄 Initializing Supabase subscription...")
    this.isSubscribed = true
    this.subscriptionId++

    try {
      const channelName = `dorm-dashboard-${this.subscriptionId}-${Date.now()}`

      this.channel = supabase
        .channel(channelName, {
          config: {
            broadcast: { self: false },
            presence: { key: "" },
          },
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "machines" }, (payload) => {
          this.handleChange("machines", payload.eventType)
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "noise_reports" }, (payload) => {
          this.handleChange("noise_reports", payload.eventType)
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, (payload) => {
          this.handleChange("announcements", payload.eventType)
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "help_requests" }, (payload) => {
          this.handleChange("help_requests", payload.eventType)
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, (payload) => {
          this.handleChange("incidents", payload.eventType)
        })
        .subscribe((status) => {
          console.log(`📡 Subscription status: ${status}`)
          if (status === "SUBSCRIBED") {
            console.log("✅ Successfully subscribed to realtime updates")
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.log("❌ Subscription error, will retry...")
            this.handleSubscriptionError()
          }
        })

      // Reduced polling frequency
      this.startPolling()
    } catch (error) {
      console.error("❌ Error initializing subscription:", error)
      this.handleSubscriptionError()
    }
  }

  private handleChange = (table: string, event: string) => {
    if (this.isDestroyed) return

    const now = Date.now()

    // Faster debouncing for better real-time experience
    // Machines get priority with 100ms debounce, others use 300ms
    const debounceTime = table === 'machines' ? 100 : 300

    if (now - this.lastChangeTime < debounceTime) {
      return
    }

    this.lastChangeTime = now
    console.log(`📡 Database change detected: ${table} - ${event}`)
    this.notifyCallbacks(table, event)
  }

  private notifyCallbacks(table?: string, event?: string) {
    if (this.isDestroyed) return

    // Use setTimeout to prevent stack overflow and allow for immediate UI updates
    // Further reduced delay for even faster real-time updates
    setTimeout(() => {
      if (this.isDestroyed) return

      this.callbacks.forEach((callback) => {
        try {
          callback(table, event)
        } catch (error) {
          console.error("❌ Error in subscription callback:", error)
        }
      })
    }, 10) // Reduced from 50ms to 10ms for faster propagation
  }

  private startPolling() {
    if (this.pollingInterval || this.isDestroyed) {
      return
    }

    // Polling every 60 seconds as fallback
    this.pollingInterval = setInterval(() => {
      if (this.isDestroyed) return
      console.log("🔄 Polling for changes...")
      this.notifyCallbacks("polling", "fallback")
    }, 60000)
  }

  private handleSubscriptionError() {
    if (this.isDestroyed) return

    this.cleanup()

    setTimeout(() => {
      if (this.callbacks.size > 0 && !this.isDestroyed) {
        console.log("🔄 Retrying subscription...")
        this.initializeSubscription()
      }
    }, 3000)
  }

  private cleanup() {
    console.log("🧹 Cleaning up subscription manager...")

    this.isSubscribed = false

    if (this.channel) {
      try {
        // Capture the channel reference and immediately set this.channel to null
        const channelToCleanup = this.channel
        this.channel = null

        // Unsubscribe from the captured channel
        channelToCleanup.unsubscribe()

        // Only call removeChannel if the channel is still valid after unsubscribe
        if (channelToCleanup) {
          supabase.removeChannel(channelToCleanup)
        }
      } catch (error) {
        console.warn("⚠️ Error during channel cleanup:", error)
      }
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
  }

  forceCleanup() {
    console.log("🧹 Force cleaning up subscription manager...")
    this.isDestroyed = true
    this.callbacks.clear()
    this.cleanup()
  }

  triggerSync() {
    if (this.isDestroyed) return
    this.notifyCallbacks("manual", "trigger")
  }
}

export default SubscriptionManager