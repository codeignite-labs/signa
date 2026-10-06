import type { Locale } from "./config"

export type AuthMode =
  | "login"
  | "register"
  | "forgot-password"
  | "reset-password"
  | "otp"

type AuthDictionary = {
  brand: string
  header: {
    signIn: string
    createAccount: string
  }
  modes: Record<
    AuthMode,
    {
      title: string
      submit: string
      fields: Array<"name" | "email" | "password" | "confirmPassword" | "otp">
    }
  >
  fields: {
    name: string
    email: string
    password: string
    newPassword: string
    confirmNewPassword: string
    otp: string
    passwordDescription: string
  }
  pending: Record<AuthMode, string>
  social: {
    google: string
  }
  links: {
    alreadyHaveAccount: string
    backToSignIn: string
    createAccount: string
    forgotPassword: string
  }
  language: string
}

export const authDictionaries: Record<Locale, AuthDictionary> = {
  en: {
    brand: "Signa",
    header: {
      signIn: "Sign In",
      createAccount: "Create Free Account",
    },
    modes: {
      login: {
        title: "Sign In",
        submit: "SIGN IN",
        fields: ["email", "password"],
      },
      register: {
        title: "Create Free Account",
        submit: "CREATE ACCOUNT",
        fields: ["name", "email", "password"],
      },
      "forgot-password": {
        title: "Forgot your password?",
        submit: "RESET PASSWORD",
        fields: ["email"],
      },
      "reset-password": {
        title: "Change your password",
        submit: "CHANGE MY PASSWORD",
        fields: ["password", "confirmPassword"],
      },
      otp: {
        title: "Sign In",
        submit: "SIGN IN",
        fields: ["otp"],
      },
    },
    fields: {
      name: "Name",
      email: "Email",
      password: "Password",
      newPassword: "New Password",
      confirmNewPassword: "Confirm New Password",
      otp: "Two-factor code from authenticator app",
      passwordDescription: "Minimum 8 characters.",
    },
    pending: {
      login: "SIGNING IN",
      register: "CREATING ACCOUNT",
      "forgot-password": "RESETTING PASSWORD",
      "reset-password": "CHANGING PASSWORD",
      otp: "SIGNING IN",
    },
    social: {
      google: "SIGN IN WITH GOOGLE",
    },
    links: {
      alreadyHaveAccount: "Already have an account",
      backToSignIn: "Back to Sign In",
      createAccount: "Create Free Account",
      forgotPassword: "Forgot your password?",
    },
    language: "Language",
  },
  sw: {
    brand: "Signa",
    header: {
      signIn: "Ingia",
      createAccount: "Fungua Akaunti Bure",
    },
    modes: {
      login: {
        title: "Ingia",
        submit: "INGIA",
        fields: ["email", "password"],
      },
      register: {
        title: "Fungua Akaunti Bure",
        submit: "FUNGUA AKAUNTI",
        fields: ["name", "email", "password"],
      },
      "forgot-password": {
        title: "Umesahau nenosiri?",
        submit: "WEKA UPYA NENOSIRI",
        fields: ["email"],
      },
      "reset-password": {
        title: "Badilisha nenosiri",
        submit: "BADILISHA NENOSIRI",
        fields: ["password", "confirmPassword"],
      },
      otp: {
        title: "Ingia",
        submit: "INGIA",
        fields: ["otp"],
      },
    },
    fields: {
      name: "Jina",
      email: "Barua pepe",
      password: "Nenosiri",
      newPassword: "Nenosiri jipya",
      confirmNewPassword: "Thibitisha nenosiri jipya",
      otp: "Msimbo wa uthibitishaji kutoka kwenye programu",
      passwordDescription: "Angalau herufi 8.",
    },
    pending: {
      login: "INAINGIA",
      register: "INAFUNGUA AKAUNTI",
      "forgot-password": "INAWEKA UPYA NENOSIRI",
      "reset-password": "INABADILISHA NENOSIRI",
      otp: "INAINGIA",
    },
    social: {
      google: "INGIA KWA GOOGLE",
    },
    links: {
      alreadyHaveAccount: "Tayari una akaunti",
      backToSignIn: "Rudi kuingia",
      createAccount: "Fungua Akaunti Bure",
      forgotPassword: "Umesahau nenosiri?",
    },
    language: "Lugha",
  },
  fr: {
    brand: "Signa",
    header: {
      signIn: "Connexion",
      createAccount: "Créer un compte gratuit",
    },
    modes: {
      login: {
        title: "Connexion",
        submit: "SE CONNECTER",
        fields: ["email", "password"],
      },
      register: {
        title: "Créer un compte gratuit",
        submit: "CRÉER UN COMPTE",
        fields: ["name", "email", "password"],
      },
      "forgot-password": {
        title: "Mot de passe oublié ?",
        submit: "RÉINITIALISER",
        fields: ["email"],
      },
      "reset-password": {
        title: "Changer le mot de passe",
        submit: "CHANGER LE MOT DE PASSE",
        fields: ["password", "confirmPassword"],
      },
      otp: {
        title: "Connexion",
        submit: "SE CONNECTER",
        fields: ["otp"],
      },
    },
    fields: {
      name: "Nom",
      email: "Email",
      password: "Mot de passe",
      newPassword: "Nouveau mot de passe",
      confirmNewPassword: "Confirmer le nouveau mot de passe",
      otp: "Code à deux facteurs depuis l'application",
      passwordDescription: "Minimum 8 caractères.",
    },
    pending: {
      login: "CONNEXION",
      register: "CRÉATION DU COMPTE",
      "forgot-password": "RÉINITIALISATION",
      "reset-password": "CHANGEMENT",
      otp: "CONNEXION",
    },
    social: {
      google: "SE CONNECTER AVEC GOOGLE",
    },
    links: {
      alreadyHaveAccount: "Vous avez déjà un compte",
      backToSignIn: "Retour à la connexion",
      createAccount: "Créer un compte gratuit",
      forgotPassword: "Mot de passe oublié ?",
    },
    language: "Langue",
  },
}
