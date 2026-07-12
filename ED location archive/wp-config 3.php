<?php
/**
 * La configuration de base de votre installation WordPress.
 *
 * Ce fichier contient les réglages de configuration suivants : réglages MySQL,
 * préfixe de table, clés secrètes, langue utilisée, et ABSPATH.
 * Vous pouvez en savoir plus à leur sujet en allant sur
 * {@link https://fr.wordpress.org/support/article/editing-wp-config-php/ Modifier
 * wp-config.php}. C’est votre hébergeur qui doit vous donner vos
 * codes MySQL.
 *
 * Ce fichier est utilisé par le script de création de wp-config.php pendant
 * le processus d’installation. Vous n’avez pas à utiliser le site web, vous
 * pouvez simplement renommer ce fichier en "wp-config.php" et remplir les
 * valeurs.
 *
 * @link https://fr.wordpress.org/support/article/editing-wp-config-php/
 *
 * @package WordPress
 */

// ** Réglages MySQL - Votre hébergeur doit vous fournir ces informations. ** //
/** Nom de la base de données de WordPress. */
define( 'DB_NAME', 'eventdream' );

/** Utilisateur de la base de données MySQL. */
define( 'DB_USER', 'root' );

/** Mot de passe de la base de données MySQL. */
define( 'DB_PASSWORD', 'root' );

/** Adresse de l’hébergement MySQL. */
define( 'DB_HOST', 'localhost' );

/** Jeu de caractères à utiliser par la base de données lors de la création des tables. */
define( 'DB_CHARSET', 'utf8mb4' );

/** Type de collation de la base de données.
  * N’y touchez que si vous savez ce que vous faites.
  */
define('DB_COLLATE', '');

/**#@+
 * Clés uniques d’authentification et salage.
 *
 * Remplacez les valeurs par défaut par des phrases uniques !
 * Vous pouvez générer des phrases aléatoires en utilisant
 * {@link https://api.wordpress.org/secret-key/1.1/salt/ le service de clés secrètes de WordPress.org}.
 * Vous pouvez modifier ces phrases à n’importe quel moment, afin d’invalider tous les cookies existants.
 * Cela forcera également tous les utilisateurs à se reconnecter.
 *
 * @since 2.6.0
 */
define( 'AUTH_KEY',         'x0fk@9QkvJ3/e(bf6ET6]nH&#_VeI[_(R%>&9c_,P,ntH-4=B6OHL`kWm_IyD~qv' );
define( 'SECURE_AUTH_KEY',  'Hrc+!>(E!lo?;c6)onQgNajU/H:zRNpYY%tZ161YGw(}4)UM%g0i}azfwAzTW5BE' );
define( 'LOGGED_IN_KEY',    'nv]^fLqH#% p;yEd.XY>CWVAN@eJ,!imA|`o~KUU?*+W;9Hyfb;&fNb[85~0`#IY' );
define( 'NONCE_KEY',        'w`mT6uYj|?UEh6u{;sCL78TYbc,zr=fwk%V~wn`5+,n!~AUG4[D`.Tq?Arl@G ~O' );
define( 'AUTH_SALT',        'RE/}n50 QYLB`&@x jv]y3d_GMNPyCf/y9sjWomBq@-=RMcWWrIf&-11Fpb|nw:c' );
define( 'SECURE_AUTH_SALT', '/azrOdv3$OB@]+R+i$cd]}`Z@o} E3>=`0Au,4LaiTYdpTZOpG:,h!t76b}hfu9Y' );
define( 'LOGGED_IN_SALT',   'f@i@)u?V7VUzXpo6>wi|)P#h/)SBntv}svL`i5Y$.q<]{Tatg!@qqLkYt-_}O wd' );
define( 'NONCE_SALT',       'l[o>hL./kWUSf[T>_|W1,7[.fU=FUC(b+%-./;PwH]-y4k>e43K^)<UjS>-PT=,%' );
/**#@-*/

/**
 * Préfixe de base de données pour les tables de WordPress.
 *
 * Vous pouvez installer plusieurs WordPress sur une seule base de données
 * si vous leur donnez chacune un préfixe unique.
 * N’utilisez que des chiffres, des lettres non-accentuées, et des caractères soulignés !
 */
$table_prefix = 'wp_';

/**
 * Pour les développeurs et développeuses : le mode déboguage de WordPress.
 *
 * En passant la valeur suivante à "true", vous activez l’affichage des
 * notifications d’erreurs pendant vos essais.
 * Il est fortement recommandé que les développeurs et développeuses d’extensions et
 * de thèmes se servent de WP_DEBUG dans leur environnement de
 * développement.
 *
 * Pour plus d’information sur les autres constantes qui peuvent être utilisées
 * pour le déboguage, rendez-vous sur la documentation.
 *
 * @link https://fr.wordpress.org/support/article/debugging-in-wordpress/
 */
define('WP_DEBUG', false);

/* C’est tout, ne touchez pas à ce qui suit ! Bonne publication. */

/** Chemin absolu vers le dossier de WordPress. */
if ( !defined('ABSPATH') )
	define('ABSPATH', dirname(__FILE__) . '/');

/** Réglage des variables de WordPress et de ses fichiers inclus. */
require_once(ABSPATH . 'wp-settings.php');
