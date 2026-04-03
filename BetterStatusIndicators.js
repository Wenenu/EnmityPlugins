/**
 * BetterStatusIndicator
 * Version: 2.0.0
 * Updated for Discord Mobile UI 2025-2026
 * Fixes DM list, Member list, Friends, and Profile for new component structure
 */

function registerPlugin(plugin) {
    window.enmity.plugins.registerPlugin(plugin);
}

const {
    modules: { common, getByProps, getByName, getByDisplayName },
    patcher,
    assets,
    settings,
    utilities
} = window.enmity;

const { React, Constants, Text, View, Image, TouchableOpacity, ScrollView } = common;
const { getIDByName } = assets;
const { get: getSetting, set: setSetting } = settings;
const { findInReactTree } = utilities;
const createPatcher = patcher.create;

const PLUGIN_NAME = "BetterStatusIndicator";
const VERSION = "2.0.0";

// Utility functions
const intToHex = (color) => "#" + ("000000" + color.toString(16)).slice(-6);

const getStatusColor = (status, customColors) => {
    const colors = {
        online: customColors.online || 3908956,
        idle: customColors.idle || 16426522,
        dnd: customColors.dnd || 15548997,
        streaming: customColors.streaming || 5846677,
        offline: customColors.offline || 7634829
    };
    return intToHex(colors[status] || colors.offline);
};

const getStatusIcon = (status) => {
    const icons = {
        online: "StatusOnline",
        idle: "StatusIdle",
        dnd: "StatusDND",
        streaming: "StatusStreaming",
        offline: "StatusOffline"
    };
    return getIDByName(icons[status] || icons.offline);
};

// Cache for platform icons
const PLATFORM_ICONS = {
    desktop: getIDByName("ic_monitor_24px") || getIDByName("screen") || getIDByName("desktop"),
    mobile: getIDByName("ic_mobile_status") || getIDByName("mobile") || getIDByName("phone"),
    web: getIDByName("ic_public") || getIDByName("globe") || getIDByName("web"),
    bot: getIDByName("ic_robot_24px") || getIDByName("bot") || getIDByName("robot")
};

const Plugin = {
    name: PLUGIN_NAME,
    version: VERSION,
    description: "Reveal statuses for every platform with customizable colors",
    authors: [{ name: "mafu", id: "519760564755365888" }, { name: "Wenenu", id: "0" }],
    color: "#da70d6",

    settings: {},
    
    onStart() {
        this.patcher = createPatcher(PLUGIN_NAME);
        this.initPatches();
        console.log(`[${PLUGIN_NAME}] Started v${VERSION}`);
    },

    onStop() {
        this.patcher.unpatchAll();
        console.log(`[${PLUGIN_NAME}] Stopped`);
    },

    initPatches() {
        try {
            this.patchStatusColors();
            this.patchDMList();
            this.patchMemberList();
            this.patchFriendsList();
            this.patchProfile();
            this.patchMobileStatus();
        } catch (err) {
            console.error(`[${PLUGIN_NAME}] Init error:`, err);
        }
    },

    // Patch 1: Status color customization
    patchStatusColors() {
        const Status = getByName("Status", { default: false });
        if (!Status?.default) {
            console.log(`[${PLUGIN_NAME}] Status component not found`);
            return;
        }

        this.patcher.after(Status, "default", (_, [props], ret) => {
            if (!ret?.props?.style) return;
            
            const colors = this.getColors();
            const status = props?.status || (props?.isStreaming ? "streaming" : "offline");
            
            ret.props.style.tintColor = getStatusColor(status, colors);
        });
    },

    // Patch 2: DM List - FIXED for new UI
    patchDMList() {
        if (!this.settings.dm) this.settings.dm = true;

        // Try multiple component names that Discord uses
        const dmComponents = [
            "PrivateChannelListItem",
            "ChannelListItem",
            "DMListItem",
            "DirectMessageChannel",
            "ChannelRow",
            "PrivateChannel"
        ];

        let patched = false;

        // Method 1: Direct component patching
        for (const name of dmComponents) {
            const Component = getByName(name, { default: false });
            if (!Component?.default || patched) continue;

            console.log(`[${PLUGIN_NAME}] Patching DM component: ${name}`);
            patched = true;

            this.patcher.after(Component, "default", (_, args, ret) => {
                const props = args[0] || {};
                
                // Extract channel and user info
                const channel = props?.channel || props?.item?.channel || props;
                const user = props?.user || props?.item?.user || channel?.recipients?.[0];
                
                // Only process DMs (type 1) that have a user
                if (channel?.type !== 1 || !user?.id) return ret;

                const icons = this.createPlatformIcons(user.id, user.bot);
                if (!icons) return ret;

                // Find the row container - look for the main content row
                const container = findInReactTree(ret, (node) => {
                    return node?.props?.style?.flexDirection === "row" && 
                           Array.isArray(node?.props?.children) &&
                           node.props.children.length >= 2; // Has multiple children (avatar + text + timestamp)
                });

                if (!container) return ret;

                const children = [...container.props.children];
                
                // Find where to insert (before timestamp or unread indicator)
                let insertIndex = children.length;
                
                // Look for timestamp (usually last or second to last)
                for (let i = children.length - 1; i >= 0; i--) {
                    const child = children[i];
                    // Check if it's a timestamp (has time text like "1m", "2h")
                    if (typeof child?.props?.children === 'string' && 
                        /^\d+[smhd]$/.test(child.props.children)) {
                        insertIndex = i;
                        break;
                    }
                    // Or if it's the badge/unread indicator
                    if (child?.props?.style?.backgroundColor || 
                        child?.type?.name?.includes("Badge")) {
                        insertIndex = i;
                        break;
                    }
                }

                // Insert the icons
                children.splice(insertIndex, 0,
                    React.createElement(View, {
                        key: "bsi-dm-icons",
                        style: { 
                            flexDirection: "row", 
                            alignItems: "center",
                            marginRight: 4,
                            marginLeft: 2
                        }
                    }, icons)
                );

                container.props.children = children;
            });
        }

        if (!patched) {
            console.log(`[${PLUGIN_NAME}] DM component not found by name, trying list renderer...`);
            this.patchDMListRenderer();
        }
    },

    // Alternative DM patching via list renderer
    patchDMListRenderer() {
        const ListComponents = [
            "ChannelList",
            "PrivateChannelList",
            "RecyclerListView",
            "FlatList"
        ];

        for (const name of ListComponents) {
            const Component = getByName(name, { default: false });
            if (!Component?.default) continue;

            this.patcher.after(Component, "default", (_, [props], ret) => {
                if (!props?.data || !props?.renderItem) return;

                const originalRender = props.renderItem;
                if (originalRender.__bsi_patched) return;

                props.renderItem = (info) => {
                    const element = originalRender(info);
                    
                    const item = info?.item;
                    if (!item) return element;

                    const channel = item.channel || item;
                    if (channel?.type !== 1) return element;

                    const user = item.user || channel?.recipients?.[0];
                    if (!user?.id) return element;

                    const icons = this.createPlatformIcons(user.id, user.bot);
                    if (!icons) return element;

                    // Inject into the rendered element
                    const container = findInReactTree(element, (node) => 
                        node?.props?.style?.flexDirection === "row" && 
                        Array.isArray(node?.props?.children)
                    );

                    if (container) {
                        container.props.children = [
                            ...container.props.children,
                            React.createElement(View, {
                                key: "bsi-icons",
                                style: { flexDirection: "row", marginLeft: 4 }
                            }, icons)
                        ];
                    }

                    return element;
                };

                props.renderItem.__bsi_patched = true;
            });
        }
    },

    // Patch 3: Member List
    patchMemberList() {
        if (!this.settings.member) this.settings.member = true;

        const MemberList = getByName("ChannelMembers", { default: false }) || 
                          getByName("ChatSidebarMembers", { default: false }) ||
                          getByName("MemberList", { default: false }) ||
                          getByName("GuildMemberList", { default: false });

        if (!MemberList?.default) {
            console.log(`[${PLUGIN_NAME}] Member list not found`);
            return;
        }

        this.patcher.after(MemberList, "default", (_, [props], ret) => {
            const list = findInReactTree(ret, (node) => 
                node?.props?.renderItem || node?.props?.renderRow
            );

            if (!list) return;

            const originalRender = list.props.renderItem || list.props.renderRow;
            if (!originalRender || originalRender.__bsi_patched) return;

            list.props.renderItem = (itemProps) => {
                const element = originalRender(itemProps);
                const user = itemProps?.user || itemProps?.item?.user;
                
                if (user?.id) {
                    const icons = this.createPlatformIcons(user.id, user.bot, { marginLeft: 4 });
                    if (icons) {
                        // Try to find the name row
                        const nameRow = findInReactTree(element, (node) => 
                            node?.props?.style?.flexDirection === "row"
                        );
                        if (nameRow && Array.isArray(nameRow.props.children)) {
                            nameRow.props.children.push(icons);
                        }
                    }
                }
                
                return element;
            };
            
            list.props.renderItem.__bsi_patched = true;
        });
    },

    // Patch 4: Friends List (You tab)
    patchFriendsList() {
        if (!this.settings.friend) this.settings.friend = true;

        const FriendsComponents = [
            "FriendsListView",
            "FriendsList",
            "FriendsTab",
            "FriendPresence",
            "FriendRow"
        ];

        for (const name of FriendsComponents) {
            const Component = getByName(name, { default: false });
            if (!Component?.default) continue;

            this.patcher.after(Component, "default", (_, [props], ret) => {
                const user = props?.user || props?.friend?.user;
                if (!user?.id) return;

                const icons = this.createPlatformIcons(user.id, user.bot);
                if (!icons) return;

                // Find the row container
                const container = findInReactTree(ret, (node) => 
                    node?.props?.style?.flexDirection === "row" && 
                    Array.isArray(node?.props?.children)
                );

                if (container) {
                    const children = [...container.props.children];
                    // Insert before last element (usually status or actions)
                    const insertIndex = Math.max(0, children.length - 1);
                    children.splice(insertIndex, 0, icons);
                    container.props.children = children;
                }
            });
        }
    },

    // Patch 5: User Profile
    patchProfile() {
        if (!this.settings.profile) this.settings.profile = true;

        // Patch badges section
        const ProfileBadges = getByName("UserProfileBadges", { default: false }) ||
                             getByName("ProfileBadges", { default: false, all: true });

        if (ProfileBadges) {
            const targets = Array.isArray(ProfileBadges) ? ProfileBadges : [ProfileBadges];
            
            targets.forEach((Component) => {
                if (!Component?.default) return;
                
                this.patcher.after(Component, "default", (_, [props], ret) => {
                    const user = props?.user;
                    if (!user?.id) return;

                    const icons = this.createPlatformIcons(user.id, user.bot, {
                        marginLeft: 4,
                        marginRight: 4
                    });

                    if (!icons) return;

                    if (Array.isArray(ret)) {
                        ret.unshift(icons);
                    } else if (ret?.props?.children) {
                        const children = Array.isArray(ret.props.children) 
                            ? ret.props.children 
                            : [ret.props.children];
                        ret.props.children = [icons, ...children];
                    }
                });
            });
        }

        // Also patch profile header for newer builds
        const ProfileHeader = getByName("UserProfileHeader", { default: false }) ||
                             getByName("ProfileHeader", { default: false });

        if (ProfileHeader?.default) {
            this.patcher.after(ProfileHeader, "default", (_, [props], ret) => {
                const user = props?.user;
                if (!user?.id) return;

                const icons = this.createPlatformIcons(user.id, user.bot);
                if (!icons) return;

                const header = findInReactTree(ret, (node) => 
                    node?.props?.style?.flexDirection === "row"
                );

                if (header && Array.isArray(header.props.children)) {
                    header.props.children.push(icons);
                }
            });
        }
    },

    // Patch 6: Mobile status indicator color
    patchMobileStatus() {
        const PresenceStore = getByProps("isMobileOnline", "getState");
        if (!PresenceStore) return;

        this.patcher.instead(PresenceStore, "isMobileOnline", (_, [userId], original) => {
            if (this.settings.coloredMobile !== false) {
                const state = PresenceStore.getState();
                return !!state?.clientStatuses?.[userId]?.mobile;
            }
            return original(userId);
        });
    },

    // Helper: Create platform icon elements
    createPlatformIcons(userId, isBot = false, customStyle = {}) {
        const PresenceStore = getByProps("getState", "clientStatuses");
        if (!PresenceStore) return null;

        const statuses = PresenceStore.getState()?.clientStatuses?.[userId];
        if (!statuses && !isBot) return null;

        const colors = this.getColors();
        const platforms = [];

        const renderIcon = (platform, status) => {
            const iconSource = PLATFORM_ICONS[platform];
            if (!iconSource) return null;

            const color = this.settings.coloredMobile !== false 
                ? getStatusColor(status, colors)
                : intToHex(0x808080); // Gray if not colored

            return React.createElement(TouchableOpacity, {
                key: `${platform}-${userId}`,
                onPress: () => {
                    const { Toasts } = common;
                    if (Toasts?.open) {
                        Toasts.open({
                            content: `${status.charAt(0).toUpperCase() + status.slice(1)} (${platform.charAt(0).toUpperCase() + platform.slice(1)})`,
                            source: getStatusIcon(status)
                        });
                    }
                }
            }, React.createElement(Image, {
                source: iconSource,
                style: {
                    width: platform === 'mobile' ? 14 : 16,
                    height: platform === 'mobile' ? 14 : 16,
                    tintColor: color,
                    marginLeft: platform === 'mobile' ? 6 : 3,
                    ...customStyle
                }
            }));
        };

        if (isBot && statuses?.web) {
            platforms.push(renderIcon("bot", "online"));
        } else {
            if (statuses?.desktop) platforms.push(renderIcon("desktop", statuses.desktop));
            if (statuses?.mobile) platforms.push(renderIcon("mobile", statuses.mobile));
            if (statuses?.web) platforms.push(renderIcon("web", statuses.web));
        }

        if (platforms.length === 0) return null;

        return React.createElement(View, {
            style: {
                flexDirection: "row",
                alignItems: "center",
                ...customStyle
            }
        }, ...platforms);
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

        // Import Form components dynamically
        const Form = getByProps("FormSection", "FormRow") || common;
        const { FormSection, FormRow, FormSwitch } = Form;
        
        const ColorPicker = getByName("CustomColorPickerActionSheet", { default: false })?.default;
        const ActionSheet = getByProps("openLazy", "hideActionSheet");

        const renderColorRow = (label, key, iconName) => {
            const currentColor = getSetting(PLUGIN_NAME, key, {
                online: 3908956, offline: 7634829, idle: 16426522,
                dnd: 15548997, streaming: 5846677
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
                            width: 24, height: 24,
                            backgroundColor: intToHex(currentColor),
                            borderRadius: 4,
                            borderWidth: 1,
                            borderColor: Constants.ThemeColorMap?.HEADER_SECONDARY || "#666"
                        }
                    }),
                    React.createElement(Text, {
                        style: {
                            color: Constants.ThemeColorMap?.TEXT_NORMAL || "#fff",
                            marginLeft: 10,
                            fontSize: 16,
                            fontFamily: Constants.Fonts?.PRIMARY_MEDIUM || "Courier",
                            width: 70
                        }
                    }, intToHex(currentColor)),
                    React.createElement(FormRow.Arrow || View, {})
                ),
                onPress: () => {
                    if (ColorPicker && ActionSheet?.openLazy) {
                        ActionSheet.openLazy(
                            Promise.resolve({ default: ColorPicker }),
                            "CustomColorPickerActionSheet",
                            {
                                color: currentColor,
                                onSelect: (color) => {
                                    setSetting(PLUGIN_NAME, key, color);
                                    ActionSheet.hideActionSheet?.();
                                }
                            }
                        );
                    }
                }
            });
        };

        const renderSwitch = (label, key, icon) => {
            const isEnabled = settings.getBoolean(key, true);
            return React.createElement(FormRow, {
                label: label,
                leading: React.createElement(FormRow.Icon, { source: getIDByName(icon) }),
                trailing: React.createElement(FormSwitch, {
                    value: isEnabled,
                    onValueChange: (v) => settings.set(key, v)
                })
            });
        };

        return React.createElement(ScrollView, { style: { flex: 1 } },
            React.createElement(FormSection, { title: "Colors" },
                renderColorRow("Online", "online", "StatusOnline"),
                renderColorRow("Offline", "offline", "StatusOffline"),
                renderColorRow("Idle", "idle", "StatusIdle"),
                renderColorRow("DND", "dnd", "StatusDND"),
                renderColorRow("Streaming", "streaming", "StatusStreaming"),
                React.createElement(FormRow, {
                    label: "Reset to Defaults",
                    leading: React.createElement(FormRow.Icon, { 
                        source: getIDByName("ic_message_retry") || getIDByName("refresh") 
                    }),
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
                renderSwitch("Member List", "member", "ic_members"),
                renderSwitch("Friends Tab", "friend", "ic_friend_wave_24px"),
                renderSwitch("Profile", "profile", "ic_profile_24px"),
                renderSwitch("DM List", "dm", "ic_mail")
            ),
            React.createElement(FormSection, { title: "Options" },
                React.createElement(FormRow, {
                    label: "Colorize Mobile Icons",
                    leading: React.createElement(FormRow.Icon, { 
                        source: getIDByName("mobile") || getIDByName("ic_mobile_status") 
                    }),
                    trailing: React.createElement(FormSwitch, {
                        value: settings.getBoolean("coloredMobile", true),
                        onValueChange: (v) => settings.set("coloredMobile", v)
                    })
                })
            ),
            React.createElement(View, { style: { height: 40 } })
        );
    }
};

registerPlugin(Plugin);
