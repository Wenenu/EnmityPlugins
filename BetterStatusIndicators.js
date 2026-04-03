/**
 * BetterStatusIndicator - Fixed for Discord 220+
 * Compatible with new Discord Mobile UI (2024-2026)
 */

function registerPlugin(plugin) {
  window.enmity.plugins.registerPlugin(plugin);
}

const {
  modules: { common, getByProps, getByName },
  patcher,
  assets,
  settings,
  utilities
} = window.enmity;

const { React, Constants, StyleSheet, Text, View, Image, TouchableOpacity, ScrollView, FormRow, FormSection, FormSwitch } = common;
const { getIDByName } = assets;
const { get: getSetting, set: setSetting } = settings;
const { findInReactTree } = utilities;
const createPatcher = patcher.create;

const PLUGIN_NAME = "BetterStatusIndicator";
const VERSION = "1.3.0-fixed";

// Color utilities
function intToHex(color) {
  return "#" + ("000000" + color.toString(16)).slice(-6);
}

function getStatusColor(status, customColors) {
  switch(status) {
    case 'online': return intToHex(customColors.online || 3908956);
    case 'idle': return intToHex(customColors.idle || 16426522);
    case 'dnd': return intToHex(customColors.dnd || 15548997);
    case 'streaming': return intToHex(customColors.streaming || 5846677);
    case 'offline': 
    default: return intToHex(customColors.offline || 7634829);
  }
}

function getStatusIcon(status) {
  const icons = {
    online: "StatusOnline",
    idle: "StatusIdle", 
    dnd: "StatusDND",
    streaming: "StatusStreaming",
    offline: "StatusOffline"
  };
  return getIDByName(icons[status] || icons.offline);
}

// Platform icons
const PLATFORM_ICONS = {
  desktop: getIDByName("ic_monitor_24px") || getIDByName("screen"),
  mobile: getIDByName("ic_mobile_status") || getIDByName("mobile"),
  web: getIDByName("ic_public") || getIDByName("globe"),
  bot: getIDByName("ic_robot_24px") || getIDByName("bot")
};

const Plugin = {
  name: PLUGIN_NAME,
  version: VERSION,
  description: "Reveal statuses for every platform with customizable colors",
  authors: [{ name: "mafu", id: "519760564755365888" }],
  color: "#da70d6",

  patches: [],
  settings: {},

  onStart() {
    this.patcher = createPatcher(PLUGIN_NAME);
    this.initPatches();
  },

  onStop() {
    this.patcher.unpatchAll();
  },

  initPatches() {
    try {
      this.patchStatusModule();
      this.patchMemberList();
      this.patchFriendsList();
      this.patchProfile();
      this.patchDMList();
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] Patch error:`, err);
    }
  },

  // Patch 1: Status colors and platform indicators
  patchStatusModule() {
    const StatusModule = getByName("Status", { default: false });
    if (!StatusModule?.default) return;

    this.patcher.after(StatusModule, "default", (_, args, ret) => {
      if (!ret?.props) return;
      
      const { status, isStreaming } = args[0] || {};
      const colors = this.getColors();
      
      // Apply custom color to status
      if (ret.props.style) {
        ret.props.style.tintColor = isStreaming ? 
          getStatusColor("streaming", colors) : 
          getStatusColor(status, colors);
      }
    });
  },

  // Patch 2: Member list (Works with virtualized lists in new UI)
  patchMemberList() {
    // Try multiple possible component names for member list
    const MemberList = getByName("ChannelMembers", { default: false }) || 
                      getByName("ChatSidebarMembers", { default: false }) ||
                      getByName("MemberList", { default: false });

    if (!MemberList) {
      console.log(`[${PLUGIN_NAME}] Member list module not found, trying alternative...`);
      // Try patching the Flux store connection instead
      this.patchViaFlux();
      return;
    }

    this.patcher.after(MemberList, "default", (_, [props], ret) => {
      if (!this.settings.member) return;
      
      // Find the list renderer
      const list = findInReactTree(ret, r => r?.props?.renderItem || r?.props?.renderRow);
      if (!list) return;

      const originalRender = list.props.renderItem || list.props.renderRow;
      if (!originalRender || originalRender.__patched) return;

      list.props.renderItem = (itemProps) => {
        const element = originalRender(itemProps);
        if (itemProps?.user) {
          this.injectPlatformIcons(element, itemProps.user.id, itemProps.user.bot);
        }
        return element;
      };
      list.props.renderItem.__patched = true;
    });
  },

  // Alternative patching method for newer builds
  patchViaFlux() {
    const UserStore = getByProps("getUser", "getCurrentUser");
    const PresenceStore = getByProps("getState", "clientStatuses");
    
    if (!PresenceStore) return;

    // Patch presence getter to expose client status
    this.patcher.after(PresenceStore, "getState", (_, __, ret) => {
      if (ret?.clientStatuses) {
        // Ensure our data is accessible
        window.__BSI_CLIENT_STATUSES = ret.clientStatuses;
      }
    });
  },

  // Patch 3: Friends list (New "You" tab layout)
  patchFriendsList() {
    // Updated component names for 2024+ UI
    const FriendsList = getByName("FriendsListView", { default: false }) ||
                       getByName("FriendsTab", { default: false }) ||
                       getByName("FriendPresence", { default: false });

    if (!FriendsList) return;

    this.patcher.after(FriendsList, "default", (_, [props], ret) => {
      if (!this.settings.friend) return;
      
      // Walk tree to find user rows
      const rows = findInReactTree(ret, r => 
        Array.isArray(r?.props?.children) && 
        r.props.children.some(c => c?.props?.userId)
      );

      if (rows) {
        rows.props.children.forEach((child, idx) => {
          if (child?.props?.userId) {
            const userId = child.props.userId;
            const iconRow = this.createPlatformIcons(userId);
            // Insert before or after based on structure
            if (child.props.children && Array.isArray(child.props.children)) {
              child.props.children.push(iconRow);
            }
          }
        });
      }
    });
  },

  // Patch 4: Profile badges (Updated for new profile UI)
  patchProfile() {
    // Try new profile component names
    const ProfileBadges = getByName("UserProfileBadges", { default: false }) ||
                         getByName("ProfileBadges", { default: false, all: true });
    
    const UserProfileHeader = getByName("UserProfileHeader", { default: false });

    // Patch method 1: Direct badge component
    if (ProfileBadges) {
      const targets = Array.isArray(ProfileBadges) ? ProfileBadges : [ProfileBadges];
      targets.forEach((BadgeComponent, idx) => {
        if (!BadgeComponent?.default) return;
        
        this.patcher.after(BadgeComponent, "default", (_, [props], ret) => {
          if (!this.settings.profile || !props?.user) return ret;
          
          const icons = this.createPlatformIcons(props.user.id, props.user.bot, {
            marginLeft: 4,
            marginRight: 4
          });
          
          // Handle both array and single element returns
          if (Array.isArray(ret)) {
            ret.unshift(icons);
            return ret;
          } else if (ret?.props?.children) {
            const children = Array.isArray(ret.props.children) ? 
              ret.props.children : [ret.props.children];
            return React.cloneElement(ret, {
              children: [icons, ...children]
            });
          }
          return React.createElement(View, { 
            style: { flexDirection: "row", alignItems: "center" } 
          }, icons, ret);
        });
      });
    }

    // Patch method 2: Header component (for newer builds)
    if (UserProfileHeader) {
      this.patcher.after(UserProfileHeader, "default", (_, [props], ret) => {
        if (!this.settings.profile || !props?.user) return;
        
        const header = findInReactTree(ret, r => 
          r?.props?.style?.flexDirection === "row" || 
          r?.type?.name?.includes("Header")
        );
        
        if (header && header.props?.children) {
          const icons = this.createPlatformIcons(props.user.id, props.user.bot);
          header.props.children = Array.isArray(header.props.children) ?
            [...header.props.children, icons] :
            [header.props.children, icons];
        }
      });
    }
  },

  // Patch 5: DM list
  patchDMList() {
    const DMList = getByName("ChannelList", { default: false }) ||
                  getByProps("ChannelList");
    
    if (!DMList) return;

    // Find DM row component
    const DMRow = getByName("ChannelRow", { default: false }) ||
                 getByName("DirectMessageRow", { default: false });

    if (DMRow?.default) {
      this.patcher.after(DMRow, "default", (_, [props], ret) => {
        if (!this.settings.dm) return;
        
        // Check if this is a DM (not a server channel)
        if (props?.channel?.type === 1 && props?.user) {
          const icons = this.createPlatformIcons(props.user.id, props.user.bot);
          // Inject into row layout
          const container = findInReactTree(ret, r => 
            r?.props?.style?.flexDirection === "row"
          );
          if (container) {
            if (!container.props.children) container.props.children = [];
            const children = Array.isArray(container.props.children) ?
              container.props.children : [container.props.children];
            container.props.children = [...children, icons];
          }
        }
      });
    }
  },

  // Helper: Create platform icon elements
  createPlatformIcons(userId, isBot = false, customStyle = {}) {
    const PresenceStore = getByProps("getState", "clientStatuses");
    if (!PresenceStore) return null;

    const statuses = PresenceStore.getState()?.clientStatuses?.[userId];
    if (!statuses && !isBot) return null;

    const colors = this.getColors();
    const platforms = [];

    if (isBot && statuses?.web) {
      platforms.push(
        React.createElement(TouchableOpacity, {
          key: "bot",
          onPress: () => this.showToast(`Bot (Online)`),
          style: { marginLeft: 5 }
        }, React.createElement(Image, {
          source: PLATFORM_ICONS.bot,
          style: { 
            width: 20, 
            height: 20, 
            tintColor: getStatusColor("online", colors),
            ...customStyle 
          }
        }))
      );
    } else {
      if (statuses?.desktop) {
        platforms.push(this.renderPlatformIcon("desktop", statuses.desktop, colors, customStyle));
      }
      if (statuses?.mobile) {
        platforms.push(this.renderPlatformIcon("mobile", statuses.mobile, colors, {
          ...customStyle,
          marginLeft: 8,
          marginRight: 5
        }));
      }
      if (statuses?.web) {
        platforms.push(this.renderPlatformIcon("web", statuses.web, colors, {
          ...customStyle,
          width: 20,
          height: 20,
          marginLeft: 2,
          marginRight: 2
        }));
      }
    }

    return React.createElement(View, {
      style: { 
        flexDirection: "row", 
        alignItems: "center",
        marginLeft: 5
      }
    }, ...platforms);
  },

  renderPlatformIcon(platform, status, colors, style = {}) {
    const iconSource = PLATFORM_ICONS[platform];
    if (!iconSource) return null;

    const color = this.settings.coloredMobile !== false ? 
      getStatusColor(status, colors) : 
      Constants.ThemeColorMap.HEADER_SECONDARY;

    return React.createElement(TouchableOpacity, {
      key: platform,
      onPress: () => this.showToast(`${status} (${platform.charAt(0).toUpperCase() + platform.slice(1)})`)
    }, React.createElement(Image, {
      source: iconSource,
      style: {
        width: platform === 'mobile' ? 16 : 20,
        height: platform === 'mobile' ? 16 : 20,
        tintColor: color,
        marginLeft: 5,
        ...style
      }
    }));
  },

  showToast(message) {
    const { Toasts } = common;
    if (Toasts?.open) {
      Toasts.open({ content: message, source: getStatusIcon("online") });
    }
  },

  injectPlatformIcons(element, userId, isBot) {
    if (!element) return;
    const icons = this.createPlatformIcons(userId, isBot);
    if (icons && element.props) {
      if (!element.props.children) element.props.children = [];
      const children = Array.isArray(element.props.children) ?
        element.props.children : [element.props.children];
      element.props.children = [...children, icons];
    }
  },

  getColors() {
    return {
      online: getSetting(PLUGIN_NAME, "online", 3908956),
      offline: getSetting(PLUGIN_NAME, "offline", 7634829),
      idle: getSetting(PLUGIN_NAME, "idle", 16426522),
      dnd: getSetting(PLUGIN_NAME, "dnd", 15548997),
      streaming: getSetting(PLUGIN_NAME, "streaming", 5846677)
    };
  },

  getSettingsPanel({ settings }) {
    this.settings = settings;
    
    const ColorPicker = getByName("CustomColorPickerActionSheet", { default: false })?.default;
    const { FormSwitchRow } = getByProps("FormSwitchRow") || {};
    
    return React.createElement(ScrollView, null,
      React.createElement(FormSection, { title: "Colors" },
        this.renderColorRow("Online", "online", "StatusOnline", settings, ColorPicker),
        this.renderColorRow("Offline", "offline", "StatusOffline", settings, ColorPicker),
        this.renderColorRow("Idle", "idle", "StatusIdle", settings, ColorPicker),
        this.renderColorRow("DND", "dnd", "StatusDND", settings, ColorPicker),
        this.renderColorRow("Streaming", "streaming", "StatusStreaming", settings, ColorPicker),
        React.createElement(FormRow, {
          label: "Reset to Default",
          leading: React.createElement(FormRow.Icon, { source: getIDByName("ic_message_retry") }),
          onPress: () => {
            setSetting(PLUGIN_NAME, "online", 3908956);
            setSetting(PLUGIN_NAME, "offline", 7634829);
            setSetting(PLUGIN_NAME, "idle", 16426522);
            setSetting(PLUGIN_NAME, "dnd", 15548997);
            setSetting(PLUGIN_NAME, "streaming", 5846677);
          }
        })
      ),
      React.createElement(FormSection, { title: "Display Locations" },
        React.createElement(FormSwitchRow || FormRow, {
          label: "Member List",
          leading: React.createElement(FormRow.Icon, { source: getIDByName("ic_members") }),
          value: settings.getBoolean("member", true),
          onValueChange: v => settings.set("member", v)
        }),
        React.createElement(FormSwitchRow || FormRow, {
          label: "Friends Tab",
          leading: React.createElement(FormRow.Icon, { source: getIDByName("ic_friend_wave_24px") }),
          value: settings.getBoolean("friend", true),
          onValueChange: v => settings.set("friend", v)
        }),
        React.createElement(FormSwitchRow || FormRow, {
          label: "Profile",
          leading: React.createElement(FormRow.Icon, { source: getIDByName("ic_profile_24px") }),
          value: settings.getBoolean("profile", true),
          onValueChange: v => settings.set("profile", v)
        }),
        React.createElement(FormSwitchRow || FormRow, {
          label: "DM List",
          leading: React.createElement(FormRow.Icon, { source: getIDByName("ic_mail") }),
          value: settings.getBoolean("dm", true),
          onValueChange: v => settings.set("dm", v)
        })
      ),
      React.createElement(FormSection, { title: "Options" },
        React.createElement(FormSwitchRow || FormRow, {
          label: "Colorize Mobile Icons",
          leading: React.createElement(FormRow.Icon, { source: getIDByName("mobile") }),
          value: settings.getBoolean("coloredMobile", true),
          onValueChange: v => settings.set("coloredMobile", v)
        })
      )
    );
  },

  renderColorRow(label, key, iconName, settings, ColorPicker) {
    const currentColor = getSetting(PLUGIN_NAME, key, {
      online: 3908956,
      offline: 7634829,
      idle: 16426522,
      dnd: 15548997,
      streaming: 5846677
    }[key]);

    return React.createElement(FormRow, {
      label: label,
      leading: React.createElement(FormRow.Icon, { 
        source: getIDByName(iconName),
        style: { tintColor: intToHex(currentColor) }
      }),
      trailing: React.createElement(View, { 
        style: { flexDirection: "row", alignItems: "center" } 
      },
        React.createElement(View, {
          style: {
            width: 24,
            height: 24,
            backgroundColor: intToHex(currentColor),
            borderRadius: 3,
            borderWidth: 1,
            borderColor: Constants.ThemeColorMap?.HEADER_SECONDARY || "#ccc"
          }
        }),
        React.createElement(Text, {
          style: {
            color: Constants.ThemeColorMap?.TEXT_NORMAL || "#000",
            marginLeft: 10,
            fontSize: 16,
            width: 72,
            fontFamily: Constants.Fonts?.PRIMARY_MEDIUM
          }
        }, intToHex(currentColor)),
        React.createElement(FormRow.Arrow, {})
      ),
      onPress: () => {
        if (ColorPicker) {
          const { ActionSheet } = getByProps("openLazy", "hideActionSheet");
          ActionSheet?.openLazy?.(
            Promise.resolve({ default: ColorPicker }),
            "CustomColorPickerActionSheet",
            {
              color: currentColor,
              onSelect: (color) => {
                setSetting(PLUGIN_NAME, key, color);
                ActionSheet?.hideActionSheet?.();
              }
            }
          );
        }
      }
    });
  }
};

registerPlugin(Plugin);
