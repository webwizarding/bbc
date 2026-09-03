/*
Ochre for Canvas - default option values.

The single source of truth. There were previously two: default_options in
background.js, which seeds storage on install, and defaultOptions in popup.js,
which backed the "reset storage" button and the popup's display fallbacks. They
had drifted -- 13 keys only in one, 10 only in the other, and 3 values that
disagreed -- so "reset" produced a materially different profile from a fresh
install, and 10 user-facing options had no install-time default at all.

Loaded as a content script, by popup.html, and by the background worker.

Where the two disagreed, the install-time value wins: it is what most users are
actually running.
*/
const OCHRE_DEFAULTS = {
    "local": {
        "previous_colors": null,
        "previous_theme": null,
        "errors": [],
        "saved_themes": {},
        "liked_themes": [],
    },
    "sync": {
        "dark_preset": {
            "background-0": "#161616",
            "background-1": "#1e1e1e",
            "background-2": "#262626",
            "borders": "#3c3c3c",
            "text-0": "#f5f5f5",
            "text-1": "#e2e2e2",
            "text-2": "#ababab",
            "links": "#56Caf0",
            "sidebar": "#1e1e1e",
            "sidebar-text": "#f5f5f5",
            "buttons": "#262626"
        },
        "new_install": true,
        "assignments_due": true,
        "gpa_calc": true,
        "dark_mode": true,
        "disable_color_overlay": false,
        "auto_dark": false,
        "auto_dark_start": {
            "hour": "20",
            "minute": "00"
        },
        "auto_dark_end": {
            "hour": "08",
            "minute": "00"
        },
        "num_assignments": 4,
        "custom_domain": [""],
        "assignments_done": [],
        "dashboard_grades": true,
        "assignment_date_format": false,
        "dashboard_notes": false,
        "dashboard_notes_text": "",
        "dashboard_notes_mode": "edit",
        "better_todo": true,
        "todo_hr24": false,
        "todo_separate_scrollbar": false,
        "better_sidebar": false,
        "condensed_cards": false,
        "custom_cards": {},
        "custom_cards_2": {},
        "custom_cards_3": {},
        "custom_assignments": [],
        "custom_assignments_overflow": ["custom_assignments"],
        "grade_hover": false,
        "card_letter": false,
        "num_todo_items": 10,
        "custom_font": {
            "link": "",
            "family": ""
        },
        "hover_preview": true,
        "full_width": null,
        "remlogo": null,
        "gpa_calc_bounds": {
            "A+": {
                "cutoff": 97,
                "gpa": 4.0
            },
            "A": {
                "cutoff": 93,
                "gpa": 4
            },
            "A-": {
                "cutoff": 90,
                "gpa": 3.7
            },
            "B+": {
                "cutoff": 87,
                "gpa": 3.3
            },
            "B": {
                "cutoff": 83,
                "gpa": 3
            },
            "B-": {
                "cutoff": 80,
                "gpa": 2.7
            },
            "C+": {
                "cutoff": 77,
                "gpa": 2.3
            },
            "C": {
                "cutoff": 73,
                "gpa": 2
            },
            "C-": {
                "cutoff": 70,
                "gpa": 1.7
            },
            "D+": {
                "cutoff": 67,
                "gpa": 1.3
            },
            "D": {
                "cutoff": 63,
                "gpa": 1
            },
            "D-": {
                "cutoff": 60,
                "gpa": 0.7
            },
            "F": {
                "cutoff": 0,
                "gpa": 0
            }
        },
        "card_overdues": false,
        "relative_dues": false,
        "equal_height_cards": false,
        "hide_new_canvas": true,
        "hide_sequence_footer": false,
        "quiz_safe_mode": false,
        "dark_mode_fix": [],
        "assignment_states": {},
        "tab_icons": false,
        "todo_hide_feedback": false,
        "todo_full_height": true,
        "todo_progress_rings": "rings",
        "todo_confetti": true,
        "device_dark": false,
        "cumulative_gpa": {
            "name": "Cumulative GPA",
            "hidden": false,
            "weight": "dnc",
            "credits": 999,
            "gr": 3.21
        },
        "card_method_date": false,
        "card_method_dashboard": true,
        "card_limit": 25,
        "remind": false,
        "reminders": [],
        "reminder_count": 1,
        "multi_remind": false,
        "id": "",
        "new_browser": null,
        "gpa_calc_prepend": false,
        "gpa_calc_cumulative": false,
        "gpa_calc_weighted": true,
        "browser_show_likes": false,
        "custom_styles": "",
        "imageSize": 100,
        "cardRoundness": 5,
        "imageRoundness": 0,
        "cardSpacing": 0,
        "cardWidth": 262,
        "cardHeight": 146,
        "customCardStyles": false,
        "customBackgroundLink": "",
        "customBackgroundScale": 100,
        "customBackgroundDaily": false,
        "customBackgroundNasaDaily": false,
        "nasaInfoOverlay": false,
        "fitImageToScreen": false,
        "bg_opacity": 65,
        "sidebar_opacity": 100,
        "bg_blur": 8,
        "sidebar_blur": 0,
        "global_search": false,
        "grade_analytics": false,
        "grade_analytics_zones": false,
        "sidebar_scale": 100,
        "card_transparency": false,
        "card_opacity": 80,
        "card_blur": 8,
        "todo_alternate_colors": false,
        "todo_ignore_card_colors": false,
        "todo_remove_icons": false,
        "center_cards": false,
        "todo_timeframe": "all",
        "cardPadding": 0,
        "gradient_cards": false,
    },
};
