import React, { useEffect, useCallback, useState } from "react";
import { Container, Nav } from "react-bootstrap";
import Lottery from "./components/lottery/Lottery";
import "./App.css";
import Wallet from "./components/Wallet";
import coverImg from "./assets/img/balls.png";
import { login, logout as destroy } from "./utils/auth";
import { balance as principalBalance, getDfxAddress } from "./utils/ledger"
import Cover from "./components/utils/Cover";
import { Notification } from "./components/utils/Notifications";



const App = function AppWrapper() {
  const isAuthenticated = window.auth.isAuthenticated;
  const principal = window.auth.principalText;

  const [balance, setBalance] = useState("0");
  const [address, setAddress] = useState("0x");

  const getBalance = useCallback(async () => {
    if (isAuthenticated) {
      setBalance(await principalBalance());
    }
  });

  const getAddress = useCallback(async () => {
    if (isAuthenticated) {
      setAddress(await getDfxAddress());
    }
  });

  useEffect(() => {
    getBalance();
    getAddress();
  }, [getBalance, getAddress()]);

  return (
    <>
    <Notification />
      {isAuthenticated ? (
        <Container fluid="md" className="hero">
          <Nav className="justify-content-end pt-3 pb-5">
            <Nav.Item>
              <Wallet
                principal={principal}
                dfxAddress={address}
                balance={balance}
                symbol={"ICP"}
                isAuthenticated={isAuthenticated}
                destroy={destroy}
              />
            </Nav.Item>
          </Nav>
          <div className="header">
            <p className="title light">ICP Lottery DApp</p>
            <p className="subtitle light">
              A lottery platform built on the ICP Blockchain 🔦
            </p>
          </div>
          <main>
            <Lottery fetchBalance={getBalance} principal={principal}/>
          </main>
        </Container>
      ) : (
        <Cover name="ICP Lottery DApp" login={login} coverImg={coverImg} />
      )}
    </>
  );
};

export default App;
