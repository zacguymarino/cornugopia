class NavBar extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          :host {
            display: block;
            background-color: #333;
            color: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          }
          nav {
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.5rem 1rem;
            font-family: Arial, sans-serif;
          }
          a {
            color: white;
            text-decoration: none;
          }
          a.logo {
            display: flex;
            align-items: center;
          }
          a.logo img {
            height: 2rem;
            margin-right: 0.5rem;
          }
          ul {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
          }
          li + li {
            margin-left: 1rem;
          }
          li a:hover {
            text-decoration: underline;
          }
        </style>
        <nav>
          <a class="logo" href="/">
            <img src="/static/cornugopia.png" alt="Cornugopia logo">
            <span>Cornugopia</span>
          </a>
          <ul>
            <li><a href="/about">About</a></li>
            <!-- add more <li><a href="…">Links</a></li> here -->
          </ul>
        </nav>
      `;
    }
  }
  
  customElements.define("nav-bar", NavBar);